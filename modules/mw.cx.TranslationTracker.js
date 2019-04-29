'use strict';

/**
 * Translation progress tracker and MT abuse detection.
 *
 * @copyright See AUTHORS.txt
 * @license GPL-2.0-or-later
 *
 * @class
 * @param {ve.init.mw.CXTarget} veTarget
 * @param {Object} config
 * @cfg {string} sourceLanguage
 * @cfg {string} targetLanguage
 */
mw.cx.TranslationTracker = function MwCXTranslationTracker( veTarget, config ) {
	this.sourceLanguage = config.sourceLanguage;
	this.targetLanguage = config.targetLanguage;
	this.veTarget = veTarget;

	this.lastFocusedSection = null;
	// A value 0.8 means we tolerate 80% unmodified machine translation in translation.
	this.unmodifiedMTThreshold = 0.8;
	// A value 0.6 means we tolerate 60% unmodified text copied from source paragraph.
	this.unmodifiedSourceThreshold = 0.6;
	// Array that stores IDs of sections with issues, along with special value for title issues.
	this.nodesWithIssues = [];
	// Sections in the translation. Associative array with section numbers as keys
	// and values as mw.cx.dm.SectionState
	this.sections = {};
	this.validationDelayQueue = [];
	this.changeQueue = [];
	this.saveQueue = [];
	this.validationScheduler = OO.ui.debounce( this.processValidationQueue.bind( this ), 15 * 1000 );
};

/* Initialization */

OO.initClass( mw.cx.TranslationTracker );

/* Static methods */

/**
 * Calculate the section translation progress based on relative number of tokens.
 * If there are 10 tokens and all translated, return 1, if 5 more tokens
 * added, return 1.5 and so on.
 * @param {string} string1
 * @param {string} string2
 * @param {string} language
 * @return {number}
 */
mw.cx.TranslationTracker.static.calculateSectionTranslationProgress = function ( string1, string2, language ) {
	var tokens1, tokens2;
	if ( string1 === string2 ) {
		return 1;
	}
	if ( !string1 || !string2 ) {
		return 0;
	}

	tokens1 = this.tokenise( string1, language );
	tokens2 = this.tokenise( string2, language );

	return tokens2.length / tokens1.length;
};

/**
 * A very simple method to calculate the difference between two strings in the scale
 * of 0 to 1, based on relative number of tokens changed in string2 from string1.
 *
 * @param {string} string1
 * @param {string} string2
 * @param {string} language
 * @return {number} A value between 0 and 1
 */
mw.cx.TranslationTracker.static.calculateUnmodifiedContent = function ( string1, string2, language ) {
	var unmodifiedTokens, bigSet, smallSet, tokens1, tokens2;

	if ( !string1 || !string2 ) {
		return 0;
	}

	if ( string1 === string2 ) {
		// Both strings are equal. So string2 is 100% unmodified version of string1
		return 1;
	}

	bigSet = tokens1 = this.tokenise( string1, language );
	smallSet = tokens2 = this.tokenise( string2, language );

	if ( tokens2.length > tokens1.length ) {
		// Swap the sets
		bigSet = tokens2;
		smallSet = tokens1;
	}

	// Find the intersection(tokens that did not change) two token sets
	unmodifiedTokens = bigSet.filter( function ( token ) {
		return smallSet.indexOf( token ) >= 0;
	} );

	// If string1 has 10 tokens and we see that 2 tokens are different or not present in string2,
	// we are saying that string2 is 80% (ie. 10-2/10) of unmodified version fo string1.
	return unmodifiedTokens.length / bigSet.length;
};

/**
 * Tokenize a given string. Here tokens is basically words for non CJK languages.
 * For CJK languages, we just split at each codepoint level.
 *
 * @param {string} string
 * @param {string} language
 * @return {string[]}
 */
mw.cx.TranslationTracker.static.tokenise = function ( string, language ) {
	if ( $.uls.data.scriptgroups.CJK.indexOf( $.uls.data.getScript( language ) ) >= 0 ) {
		return string.split( '' );
	}

	// Match all non whitespace characters for tokens.
	return string.match( /\S+/g ) || [];
};

/* Methods */

/**
 * Initialize translation.
 *
 * @param {mw.cx.dm.Translation} translationModel
 */
mw.cx.TranslationTracker.prototype.init = function ( translationModel ) {
	var i, sectionNumber, sectionModels, sectionModel, sectionState,
		savedTranslationUnits, savedTranslationUnit, progress,
		restoredSections = 0;

	sectionModels = translationModel.sourceDoc.getNodesByType( 'cxSection' );
	savedTranslationUnits = translationModel.savedTranslationUnits || [];
	for ( i = 0; i < sectionModels.length; i++ ) {
		sectionModel = sectionModels[ i ];

		sectionNumber = sectionModel.getSectionNumber();
		sectionState = new mw.cx.dm.SectionState( sectionNumber );
		sectionState.setSource( ve.dm.converter.getDomFromNode( sectionModel ).body.innerHTML );
		savedTranslationUnit = savedTranslationUnits[ sectionNumber ];
		if ( savedTranslationUnit ) {
			if ( savedTranslationUnit.user ) {
				sectionState.setCurrentMTProvider( savedTranslationUnit.user.engine );
				sectionState.setUserTranslation( savedTranslationUnit.user.content );
			}
			if ( savedTranslationUnit.mt ) {
				// Machine translation, unmodified.
				sectionState.setCurrentMTProvider( savedTranslationUnit.mt.engine );
				sectionState.setUnmodifiedMT( savedTranslationUnit.mt.content );
				sectionState.markUnmodifiedMTSaved();
			}
			restoredSections++;
			this.changeQueue.push( sectionNumber );
		}

		this.sections[ sectionNumber ] = sectionState;
	}

	this.adjustSectionStateForSourceTranslations( this.getSectionsTranslatedFromSource( translationModel ) );

	mw.log( '[CX] Translation tracker initialized for ' +
		sectionModels.length + ' sections (' + restoredSections + ' restored)' );

	if ( restoredSections > 0 ) {
		progress = this.getTranslationProgress();
		if ( !OO.compare( translationModel.progress, progress ) ) {
			mw.log.error( '[CX] Mismatch in restored translation has progress. Saved progress was: ' +
				JSON.stringify( translationModel.progress ) );
		}
		mw.log( '[CX] Restored translation has progress: ' + JSON.stringify( progress ) );
		// Do the change processing and validations on the restored sections without any delay.
		this.processChangeQueue();
		this.processValidationQueue();
	}

	this.attachOnFocusListeners( translationModel.targetDoc.getNodesByType( 'cxSection' ) );
};

/**
 * Attach listeners for 'focus' events on restored sections as well as on newly added sections.
 *
 * @param {ve.dm.CXSectionNode[]} sections
 */
mw.cx.TranslationTracker.prototype.attachOnFocusListeners = function ( sections ) {
	// Register event listeners for 'focus' event on restored sections
	sections.map( function ( sectionModel ) {
		return sectionModel.getId();
	} ).forEach( this.registerOnFocusListenerForSection.bind( this ) );

	// Register event listeners for 'focus' event for every newly added section
	this.veTarget.connect( this, { changeContentSource: 'registerOnFocusListenerForSection' } );
};

/**
 * When section is translated by adapting the source section, that is not saved in the
 * parallel corpora table. So, when we restore that section, we don't have anything to
 * compare user translation to, when section progress is calculated.
 * Therefore, use source content as unmodified MT.
 *
 * @param {number[]} sectionIds Array of IDs of sections translated from source.
 */
mw.cx.TranslationTracker.prototype.adjustSectionStateForSourceTranslations = function ( sectionIds ) {
	if ( !Array.isArray( sectionIds ) ) {
		throw new Error( 'Must provide IDs of sections translated from source as array' );
	}

	sectionIds.forEach( function ( sectionId ) {
		var sectionState = this.sections[ sectionId ];

		sectionState.setCurrentMTProvider( 'source' );
		sectionState.setUnmodifiedMT( sectionState.getSource().html );
	}.bind( this ) );
};

/**
 * @param {mw.cx.dm.Translation} translationModel
 * @return {number[]} IDs of sections translated from source.
 */
mw.cx.TranslationTracker.prototype.getSectionsTranslatedFromSource = function ( translationModel ) {
	var targetSections = translationModel.targetDoc.getNodesByType( 'cxSection' );

	return targetSections.filter( function ( sectionModel ) {
		return sectionModel.getOriginalContentSource() === 'source';
	} ).map( function ( sectionModel ) {
		return sectionModel.getId();
	} );
};

/**
 * Process the change queue.
 * This will be called by getTranslationProgress when saving happens, also
 * by section changes in debounced manner.
 */
mw.cx.TranslationTracker.prototype.processChangeQueue = function () {
	var i = this.changeQueue.length;
	while ( i-- ) {
		this.processSectionChange( this.changeQueue[ i ] );
		this.changeQueue.splice( i, 1 );
	}
};

/**
 * Section change handler
 *
 * @param {string} sectionNumber
 */
mw.cx.TranslationTracker.prototype.processSectionChange = function ( sectionNumber ) {
	var sectionModel, sectionState, newContent, existingContent,
		currentMTProvider, unmodifiedMTContent, newMTProvider, freshTranslation;

	sectionModel = this.veTarget.getTargetSectionNodeFromSectionNumber( sectionNumber );
	if ( !sectionModel ) {
		// sectionModel can be null in case this handler is executed while the node
		// is being modified. Since this method is debounced, chances are rare.
		// Still checking for null.
		return;
	}
	sectionState = this.sections[ sectionNumber ];

	if ( !( sectionModel instanceof ve.dm.CXSectionNode ) ) {
		// sectionModel can be a a PlaceholderNode by undo operation too.
		sectionState.setCurrentMTProvider( null );
		sectionState.setUserTranslation( '' );
		// Remove it from the delayed queues.
		this.removeSectionFromSaveQueue( sectionNumber );
		this.removeSectionFromValidationQueue( sectionNumber );
		return;
	}

	currentMTProvider = sectionState.getCurrentMTProvider();
	newMTProvider = sectionModel.getOriginalContentSource();
	if ( currentMTProvider !== newMTProvider ) {
		// Fresh translation or MT Engine change
		mw.log( '[CX] MT Engine change for section ' + sectionNumber + ' to MT ' + newMTProvider );
		sectionState.setCurrentMTProvider( newMTProvider );
		// Reset the saved content in section state.
		sectionState.setUserTranslation( null );
		freshTranslation = true;
	}

	newContent = ve.dm.converter.getDomFromNode( sectionModel ).body.innerHTML;
	existingContent = sectionState.getUserTranslation();
	unmodifiedMTContent = sectionState.getUnmodifiedMT();
	if ( !unmodifiedMTContent.html ) {
		// Fresh translation. Extract and save the unmodified MT content to section state.
		sectionState.setCurrentMTProvider( newMTProvider );
		sectionState.setUnmodifiedMT( newContent );
		mw.log( '[CX] Fresh translation for section ' + sectionNumber + ' with MT ' + newMTProvider );
	}
	if ( newContent !== existingContent.html ) {
		// A modification of user translated content. Save the modified content to section state
		sectionState.setUserTranslation( newContent );
		mw.log( '[CX] Content modified for section ' + sectionNumber + ' with MT ' + newMTProvider );
	}

	// NOTE: For unmodified MT, we use the same content for userTranslatedContent

	// Let the section model know whether it has been modified on top of initial value
	sectionModel.setHasUserModifications( sectionState.isModified() );

	// Calculate and update the progress
	this.updateSectionProgress( sectionNumber );

	if ( freshTranslation ) {
		// For freshly translated section, delay the validation till next action on same section
		// or other sections. But do validations for any queued sections.
		this.processValidationQueue();
		this.pushToValidationQueue( sectionNumber );
		return;
	}

	this.pushToValidationQueue( sectionNumber );
	this.validationScheduler();
};

/**
 * Calculate and update the section translation progress.
 * @param {number} sectionNumber
 */
mw.cx.TranslationTracker.prototype.updateSectionProgress = function ( sectionNumber ) {
	var unmodifiedPercentage, progress,
		sectionState = this.sections[ sectionNumber ],
		unmodifiedContent = sectionState.getUnmodifiedMT(),
		userTranslation = sectionState.getUserTranslation();

	unmodifiedPercentage = this.constructor.static.calculateUnmodifiedContent(
		unmodifiedContent.text,
		userTranslation.text,
		this.targetLanguage
	);
	sectionState.setUnmodifiedPercentage( unmodifiedPercentage );

	// Calculate the progress. It is a value between 0 and 1
	progress = this.constructor.static.calculateSectionTranslationProgress(
		sectionState.getSource().text,
		userTranslation.text,
		this.targetLanguage
	);
	sectionState.setTranslationProgressPercentage( progress );
};

/**
 * Check if a section has unmodified MT beyond a threshold. If so, add a warning issue
 * to the section model.
 * @param {number} sectionNumber
 * @return {boolean} Whether the section is crossing the unmodified MT threshold
 */
mw.cx.TranslationTracker.prototype.validateForMTAbuse = function ( sectionNumber ) {
	var sourceTokens,
		sectionState = this.sections[ sectionNumber ];

	sourceTokens = this.constructor.static.tokenise( sectionState.getSource().text, this.sourceLanguage );
	if ( sourceTokens.length < 10 ) {
		// Exclude smaller sections from MT abuse validations
		return false;
	}

	return sectionState.getUnmodifiedPercentage() > this.getMTThresholdForSection( sectionState );
};

mw.cx.TranslationTracker.prototype.setMTAbuseWarning = function ( sectionModel ) {
	var percentage, sectionState;

	sectionState = this.sections[ sectionModel.getSectionNumber() ];
	percentage = mw.language.convertNumber(
		Math.round( sectionState.getUnmodifiedPercentage() * 100 ) );
	mw.log( '[CX] Unmodified MT percentage for section ' + sectionModel.getSectionNumber() +
		' ' + percentage + '% crossed the threshold ' + this.getMTThresholdForSection( sectionState ) * 100 );

	sectionModel.addTranslationIssues( [ {
		name: 'mt-abuse',
		message: mw.message( 'cx-mt-abuse-warning-text' ),
		messageInfo: {
			title: mw.msg( 'cx-mt-abuse-warning-title', percentage ),
			type: 'warning',
			help: mw.msg( 'cx-tools-view-guidelines-link' ),
			resolvable: true
		}
	} ] );
};

/**
 * @param {mw.cx.dm.SectionState} sectionState
 * @return {number} Threshold which indicates if text is considered insufficiently modified
 * to be treated as a good translation:
 * - For paragraphs started with MT,
 * content is considered unmodified above the threshold of `this.unmodifiedMTThreshold`.
 * - For paragraphs started by copying the source text,
 * content is considered unmodified above the threshold of `this.unmodifiedSourceThreshold`.
 */
mw.cx.TranslationTracker.prototype.getMTThresholdForSection = function ( sectionState ) {
	return sectionState.getCurrentMTProvider() === 'source' ?
		this.unmodifiedSourceThreshold : this.unmodifiedMTThreshold;
};

mw.cx.TranslationTracker.prototype.clearMTAbuseWarning = function ( sectionModel ) {
	if ( sectionModel && sectionModel instanceof ve.dm.CXSectionNode ) {
		sectionModel.resolveTranslationIssues( [ 'mt-abuse' ] );
	}
};

/**
 * Calculate the percentage of machine translation for all sections.
 * This is relative to the total number of sections in source.
 *
 * @return {Object} Map of weights
 * @return {number} return.any Weight of sections with content
 * @return {number} return.human Weight of sections with human modified content
 * @return {number} return.mt Weight of sections with unmodified mt content
 * @return {number} return.mtSectionsCount Count of sections with unmodified mt content
 * @return {number} return.translatedSectionsCount Number of sections translated
 */
mw.cx.TranslationTracker.prototype.getTranslationProgress = function () {
	var sectionNumber, sectionState,
		totalSourceSections = 0,
		sectionsWithAnyTranslation = 0,
		sectionsWithUserTranslation = 0,
		sectionsWithUnmodifiedContent = 0;

	totalSourceSections = Object.keys( this.sections ).length;

	for ( sectionNumber in this.sections ) {
		if ( !Object.prototype.hasOwnProperty.call( this.sections, sectionNumber ) ) {
			continue;
		}

		// Recalculate the progress. Make sure we are not using old data.
		this.processChangeQueue();
		this.updateSectionProgress( sectionNumber );

		sectionState = this.sections[ sectionNumber ];
		if ( sectionState.getUserTranslation().text === '' ) {
			// Section blanked. Consider as not translated.
			continue;
		}

		if ( sectionState.getUnmodifiedMT().text || sectionState.getUserTranslation().text ) {
			// Section with any type of translation
			sectionsWithAnyTranslation++;
		} else {
			// Section not translated at all.
			continue;
		}

		if ( !sectionState.isModified() ) {
			// Section with umodified translation
			sectionsWithUnmodifiedContent++;
		} else if ( sectionState.getUserTranslation().text ) {
			// Section with human modified translation
			sectionsWithUserTranslation++;
		}
	}

	return {
		any: sectionsWithAnyTranslation / totalSourceSections,
		human: sectionsWithUserTranslation / totalSourceSections,
		mt: sectionsWithUnmodifiedContent / totalSourceSections,
		mtSectionsCount: sectionsWithUnmodifiedContent,
		translatedSectionsCount: sectionsWithUnmodifiedContent + sectionsWithUserTranslation
	};
};

/**
 * Get percentage of unmodified tokens in translation.
 *
 * @return {number} Number of unmodified tokens relative to total user translation tokens.
 */
mw.cx.TranslationTracker.prototype.getUnmodifiedMTPercentageInTranslation = function () {
	var targetSections,
		unmodifiedTokens = 0,
		totalTokens = 0;

	targetSections = this.veTarget.translation.targetDoc.getNodesByType( 'article' )[ 0 ].getChildren()
		.filter( function ( node ) {
			return node.getType() === 'cxSection';
		} );

	targetSections.forEach( function ( sectionModel ) {
		var sectionState = this.sections[ sectionModel.getId() ],
			unmodifiedMTTokens = this.constructor.static.tokenise(
				sectionState.getUnmodifiedMT().text,
				this.targetLanguage
			),
			userTranslationTokens = this.constructor.static.tokenise(
				sectionState.getUserTranslation().text,
				this.targetLanguage
			);

		totalTokens += userTranslationTokens.length;
		unmodifiedTokens += userTranslationTokens.filter( function ( token ) {
			return unmodifiedMTTokens.indexOf( token ) >= 0;
		} ).length;
	}, this );

	return ( unmodifiedTokens / totalTokens ) * 100;
};

/**
 * @param {number} sectionNumber
 */
mw.cx.TranslationTracker.prototype.registerOnFocusListenerForSection = function ( sectionNumber ) {
	var sectionNode = this.veTarget.getTargetSectionElementFromSectionNumber( sectionNumber );

	sectionNode.connect( this, { focus: [ 'onSectionFocus', sectionNumber ] } );
};

/**
 * @param {number} focusedSectionNumber
 */
mw.cx.TranslationTracker.prototype.onSectionFocus = function ( focusedSectionNumber ) {
	if ( this.lastFocusedSection !== focusedSectionNumber ) {
		this.processValidationQueue();
	}

	this.lastFocusedSection = focusedSectionNumber;
};

/**
 * Process any delayed validations on sections.
 */
mw.cx.TranslationTracker.prototype.processValidationQueue = function () {
	var i, sectionNumber, sectionModel;

	i = this.validationDelayQueue.length;
	while ( i-- ) {
		sectionNumber = this.validationDelayQueue[ i ];
		sectionModel = this.veTarget.getTargetSectionNodeFromSectionNumber( sectionNumber );
		if ( !this.isExcludedFromValidation( sectionModel ) ) {
			if ( this.validateForMTAbuse( sectionNumber ) ) {
				this.setMTAbuseWarning( sectionModel );
			} else {
				this.clearMTAbuseWarning( sectionModel );
			}
		}
		this.validationDelayQueue.splice( i, 1 );
	}
};

/**
 * Check if the section is excluded from MT abuse validation or not.
 * @param {ve.dm.CXSectionNode} sectionModel
 * @return {boolean}
 */
mw.cx.TranslationTracker.prototype.isExcludedFromValidation = function ( sectionModel ) {
	var excludedTypes = [
			'cxBlockImage', 'mwBlockImage', // Both are required since new images can be inserted too.
			'cxTransclusionBlock', 'mwTransclusionBlock',
			'mwReferencesList',
			'mwTable', 'list', 'mwHeading'
		],
		childType = sectionModel.getChildNodeName();

	return excludedTypes.indexOf( childType ) >= 0;
};

/**
 * Adds new nodes with issues to the tracking array. Nodes that have
 * their issues resolved, are removed from the array.
 *
 * @param {number|string} id Section number or special values of 'title' and 'global'
 * @param {boolean} state True if node has issues
 */
mw.cx.TranslationTracker.prototype.setTranslationIssues = function ( id, state ) {
	var index = this.nodesWithIssues.indexOf( id ),
		sortLettersAndNumbers = function ( a, b ) {
			// When 'title' and 'global' are compared, put 'global' in front
			if ( isNaN( a ) && isNaN( b ) ) {
				return a > b ? 1 : -1;
			}

			// When `a` is string ('global' or 'title'), put it before numerical values
			if ( isNaN( a ) ) {
				return -1;
			}

			// When `a` is number, put it after string values
			if ( isNaN( b ) ) {
				return 1;
			}

			return a > b ? 1 : -1;
		};

	if ( index !== -1 ) {
		if ( !state ) {
			this.nodesWithIssues.splice( index, 1 );
		}

		return;
	} else if ( !state ) {
		return;
	}

	this.nodesWithIssues.push( id );
	// Sort, so that special string keys, like 'title' or 'global' come first
	// and then section numbers in ascending order. Duplicates are unexpected
	this.nodesWithIssues.sort( sortLettersAndNumbers );
};

/**
 * Get IDs of all nodes with issues. Nodes include target title, translation sections.
 * Unattached issues don't have a node, but are kept in mw.cx.dm.Translation.
 *
 * @return {Mixed[]} Node IDs
 */
mw.cx.TranslationTracker.prototype.getNodesWithIssues = function () {
	return this.nodesWithIssues;
};

/**
 * Check if the section is in the change queue
 * @param {string} sectionNumber
 * @return {boolean}
 */
mw.cx.TranslationTracker.prototype.isSectionInChangeQueue = function ( sectionNumber ) {
	return this.changeQueue.indexOf( sectionNumber ) >= 0;
};

mw.cx.TranslationTracker.prototype.pushToChangeQueue = function ( sectionNumber ) {
	if ( !this.isSectionInChangeQueue( sectionNumber ) ) {
		this.changeQueue.push( sectionNumber );
	}
};

/**
 * Check if the section is in the save queue
 * @param {string} sectionNumber
 * @return {boolean}
 */
mw.cx.TranslationTracker.prototype.isSectionInSaveQueue = function ( sectionNumber ) {
	return this.saveQueue.indexOf( sectionNumber ) >= 0;
};

mw.cx.TranslationTracker.prototype.pushToSaveQueue = function ( sectionNumber ) {
	if ( !this.isSectionInSaveQueue( sectionNumber ) ) {
		this.saveQueue.push( sectionNumber );
	}
};

mw.cx.TranslationTracker.prototype.pushToValidationQueue = function ( sectionNumber ) {
	if ( this.validationDelayQueue.indexOf( sectionNumber ) < 0 ) {
		this.validationDelayQueue.push( sectionNumber );
	}
};

/**
 * Remove section from the save queue for the given section number,
 * @param {string} sectionNumber
 */
mw.cx.TranslationTracker.prototype.removeSectionFromSaveQueue = function ( sectionNumber ) {
	var index = this.saveQueue.indexOf( sectionNumber );
	if ( index >= 0 ) {
		this.saveQueue.splice( index, 1 );
	} else {
		mw.log.warn( '[CX] Attempting to remove non-existing section ' + sectionNumber + ' from save queue.' );
	}
};

/**
 * Remove section from the validation delay queue for the given section number,
 * @param {string} sectionNumber
 */
mw.cx.TranslationTracker.prototype.removeSectionFromValidationQueue = function ( sectionNumber ) {
	var index = this.validationDelayQueue.indexOf( sectionNumber );
	if ( index >= 0 ) {
		this.validationDelayQueue.splice( index, 1 );
	}
};

/**
 * Get the current save queue
 * @return {number[]}
 */
mw.cx.TranslationTracker.prototype.getSaveQueue = function () {
	return this.saveQueue;
};

/**
 * Get the section state for the given section number,
 * @param {number} sectionNumber
 * @return {mw.cx.dm.SectionState}
 */
mw.cx.TranslationTracker.prototype.getSectionState = function ( sectionNumber ) {
	return this.sections[ sectionNumber ];
};
