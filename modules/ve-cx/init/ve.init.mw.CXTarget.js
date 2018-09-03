'use strict';

/**
 * CX Target
 *
 * @copyright See AUTHORS.txt
 * @license GPL-2.0-or-later
 *
 * @class
 * @param {mw.cx.ui.TranslationView} translationView
 * @param {Object} [config] Configuration object
 * TODO: Only pass optional parameters in config
 * @cfg {mw.cx.SiteMapper} siteMapper
 * @cfg {mw.cx.MachineTranslationManager} MTManager
 * @cfg {mw.cx.MachineTranslationService} MTService
 * TODO: toolbarConfig
 */
ve.init.mw.CXTarget = function VeInitMwCXTarget( translationView, config ) {
	// Configuration initialization
	this.config = config = $.extend( {}, config, {
		continuous: true,
		expanded: false,
		scrollable: false,
		padded: false
	} );
	config.toolbarConfig = $.extend(
		{ shadow: true, actions: true, floatable: false, $overlay: true },
		config.toolbarConfig
	);
	// Parent constructor
	ve.init.mw.CXTarget.super.call( this, config );

	this.MTManager = config.MTManager;
	this.MTService = config.MTService;
	this.siteMapper = config.siteMapper;
	this.requestManager = config.requestManager;

	this.errorsInTranslation = false;

	// @var {mw.cx.dm.Translation}
	this.translation = null;
	// @var {mw.cx.ui.TranslationView}
	this.translationView = translationView;
	this.publishButton = this.translationView.translationHeader.publishButton;
	// @var {string}
	this.pageName = this.translationView.targetColumn.getTitle();
	// @var {ve.ui.CXSurface}
	this.sourceSurface = null;
	// @var {ve.ui.CXSurface}
	this.targetSurface = null;
	// @var {Object}
	this.contentSourceCache = {};

	// Complex dialog is the dialog with VE surface.
	// In order to reset the overlay classes, which move overlay, we want only the first
	// complex dialog to reset these classes, since complex dialogs can be nested. See T193587
	this.complexDialogOpened = false;
	this.contextStack = [];

	this.$element
		.addClass( 've-init-mw-cxTarget' )
		.append( this.translationView.$element );

	this.debounceAlignSectionPairs = OO.ui.debounce(
		this.alignSectionPairs.bind( this ),
		500
	);

	this.translationView.connect( this, {
		issuesResolved: 'onIssuesResolved',
		translationIssues: 'onTranslationIssues'
	} );

	this.translationView.targetColumn.connect( this, {
		titleChange: 'onTargetTitleChange'
	} );

	this.connect( this, {
		contentChange: 'onChange',
		surfaceReady: 'onSurfaceReady'
	} );
	mw.hook( 'mw.cx.draft.restored' ).add( this.onTranslationRestore.bind( this ) );
};

/* Inheritance */

OO.inheritClass( ve.init.mw.CXTarget, ve.init.mw.Target );

/* Static Properties */

ve.init.mw.CXTarget.static.name = 'cx';

ve.init.mw.CXTarget.static.actionGroups = [
	// Publish destination
	{
		name: 'publishDestination',
		header: OO.ui.deferMsg( 'cx-publish-destination-header' ),
		title: OO.ui.deferMsg( 'cx-publish-destination-tooltip' ),
		icon: 'advanced',
		indicator: null,
		type: 'menu',
		include: [ { group: 'cxDestination' } ]
	}
];

ve.init.mw.CXTarget.static.translationToolbarGroups = [
	{
		name: 'cx-mt',
		type: 'menu',
		include: [ { group: 'mt' } ]
	}
];

ve.init.mw.CXTarget.static.toolbarGroups = [
	// History
	{
		name: 'history',
		include: [ 'undo', 'redo' ]
	},
	// Style
	{
		name: 'style',
		classes: [ 've-cx-toolbar-style' ],
		type: 'list',
		icon: 'textStyle',
		title: OO.ui.deferMsg( 'visualeditor-toolbar-style-tooltip' ),
		include: [ { group: 'textStyle' }, 'language', 'clear' ],
		forceExpand: [ 'bold', 'italic', 'clear' ],
		promote: [ 'bold', 'italic' ],
		demote: [ 'strikethrough', 'code', 'underline', 'language', 'clear' ]
	},
	// Link
	{
		name: 'link',
		classes: [ 've-cx-toolbar-link' ],
		include: [ 'link' ]
	},
	// Structure
	{
		name: 'structure',
		classes: [ 've-cx-toolbar-structure' ],
		type: 'list',
		icon: 'listBullet',
		title: OO.ui.deferMsg( 'visualeditor-toolbar-structure' ),
		include: [ { group: 'structure' } ],
		demote: [ 'outdent', 'indent' ]
	},
	// Placeholder for reference tools (e.g. Cite)
	{
		name: 'reference'
	},
	// Insert
	{
		name: 'extra',
		classes: [ 've-cx-toolbar-insert' ],
		icon: 'ellipsis',
		label: '',
		indicator: null,
		type: 'list',
		title: OO.ui.deferMsg( 'visualeditor-toolbar-insert' ),
		include: '*',
		exclude: [ { group: 'format' } ],
		forceExpand: [ 'media', 'transclusion', 'insertTable', 'specialCharacter' ],
		promote: [ 'media', 'transclusion', 'insertTable', 'specialCharacter' ]
	}
];

/* Methods */

ve.init.mw.CXTarget.prototype.setupToolbar = function () {
	// Parent method
	ve.init.mw.CXTarget.super.prototype.setupToolbar.apply( this, arguments );

	this.publishButton.connect( this, {
		click: 'onPublishButtonClick'
	} );
	mw.hook( 'mw.cx.progress' ).add( function ( weights ) {
		this.publishButton.setDisabled( weights.any === 0 );
	}.bind( this ) );

	this.toolbar.$actions.append( this.publishButton.$element );

	this.translationView.translationHeader.$toolbar.append( this.toolbar.$actions );
};

ve.init.mw.CXTarget.prototype.unbindHandlers = function () {
	// Parent method
	ve.init.mw.CXTarget.super.prototype.unbindHandlers.call( this );

	$( this.getElementWindow() ).off( 'resize', this.debounceAlignSectionPairs );
};

/**
 * Present the source article and section placeholders
 *
 * @param {mw.cx.dm.Translation} translation
 */
ve.init.mw.CXTarget.prototype.setTranslation = function ( translation ) {
	var sourceSurface, targetSurface;

	this.translation = translation;
	this.sourceSurface = sourceSurface = this.createSurface(
		this.translation.sourceDoc,
		this.getSurfaceConfig( {
			classes: [ 've-ui-cxSurface', 've-ui-cxSourceSurface', 'mw-body-content' ]
		} )
	);
	this.targetSurface = targetSurface = this.createSurface(
		this.translation.targetDoc,
		this.getSurfaceConfig( {
			classes: [ 've-ui-cxSurface', 've-ui-cxTargetSurface', 'mw-body-content' ]
		} )
	);
	sourceSurface.setDisabled( true );
	this.translationView.sourceColumn.setTranslation( translation );
	this.translationView.targetColumn.setTranslation( translation );
	this.translationView.toolsColumn.setTranslation( translation );
	this.clearSurfaces();
	this.surfaces.push( targetSurface );
	targetSurface.getDialogs().connect( this, {
		opening: this.onDialogOpening.bind( this, targetSurface.getContext() ),
		closing: 'onDialogClosing'
	} );
	targetSurface.getGlobalOverlay().$element.addClass( 've-cx-ui-overlay-global' );
	targetSurface.getView().connect( this, {
		focus: [ 'onSurfaceViewFocus', targetSurface ]
	} );
	this.setSurface( targetSurface );
	targetSurface.getModel().getDocument().connect( this, {
		transact: 'onDocumentTransact'
	} );
	targetSurface.getView().getDocument().connect( this, {
		activatePlaceholder: 'onDocumentActivatePlaceholder'
	} );
	this.translationView.sourceColumn.attachSurface( sourceSurface );
	this.translationView.targetColumn.attachSurface( targetSurface );
	sourceSurface.initialize();
	targetSurface.initialize();

	this.setupHighlighting( sourceSurface.getView().$element, targetSurface.getView().$element );

	$( this.getElementWindow() ).on( 'resize', this.debounceAlignSectionPairs );
	// Wait for document to render fully.
	// In mw.Target this happens after documentReady and a setTimeout,
	// but we don't use documentReady in this target.
	setTimeout( this.surfaceReady.bind( this ) );
};

ve.init.mw.CXTarget.prototype.setupHighlighting = function ( $sourceView, $targetView ) {
	var $views = $( [ $sourceView[ 0 ], $targetView[ 0 ] ] ),
		targetSurface = this.targetSurface;

	$views.on(
		{
			mouseenter: function () {
				var segmentSelector;

				// If target surface is disabled (usually during publishing)
				// don't proceed with sentence highlighting
				if (
					targetSurface.isDisabled() ||
					this.classList.contains( 'cx-sentence-highlight' )
				) {
					return;
				}

				segmentSelector = '[data-segmentid="_"]'.replace( '_', this.dataset.segmentid );
				$views.find( segmentSelector ).addClass( 'cx-sentence-highlight' );
			},
			mouseleave: function () {
				$views.find( '.cx-sentence-highlight' ).removeClass( 'cx-sentence-highlight' );
			}
		},
		'.cx-segment'
	);

	$targetView.on(
		{
			mouseenter: function () {
				var sectionNumber;

				// If target surface is disabled (usually during publishing)
				// don't proceed with section highlighting
				if (
					targetSurface.isDisabled() ||
					this.classList.contains( 'cx-section-highlight' )
				) {
					return;
				}

				sectionNumber = mw.cx.getSectionNumberFromSectionId( this.id );
				document.getElementById( 'cxSourceSection' + sectionNumber )
					.classList.add( 'cx-section-highlight' );
			},
			mouseleave: function () {
				$views.find( '.cx-section-highlight' ).removeClass( 'cx-section-highlight' );
			}
		},
		'[rel="cx:Placeholder"]'
	);
};

/**
 * @inheritdoc
 */
ve.init.mw.CXTarget.prototype.createSurface = function ( dmDoc, config ) {
	var surface, documentView;

	surface = new ve.ui.CXSurface( dmDoc, this.translationView.toolsColumn, config );

	surface.$element.addClass( this.protectedClasses );

	// T164790
	documentView = surface.getView().getDocument();
	// The following classes are used here
	// * mw-content-ltr
	// * mw-content-rtl
	documentView.getDocumentNode().$element.addClass( 'mw-parser-output mw-content-' + documentView.getDir() );

	// If configuration object has 'inDialog' param, that means surface is created for usage
	// inside a modal dialog. Such compex dialogs need to have access to context tools inside
	// tools column, so we move the overlay. Also, other, non-complex tools, shouldn't be
	// showing. See T193587
	if ( config.inDialog ) {
		surface.getDialogs().connect( this, {
			opening: this.onDialogOpening.bind( this, surface.getContext() ),
			closing: 'onDialogClosing'
		} );

		if ( !this.complexDialogOpened ) {
			this.toggleContextTools( true );
			surface.connect( this, { destroy: [ 'toggleContextTools', false ] } );
		}
	}

	return surface;
};

ve.init.mw.CXTarget.prototype.surfaceReady = function () {
	// Parent method
	ve.init.mw.CXTarget.super.prototype.surfaceReady.apply( this, arguments );

	this.debounceAlignSectionPairs();
};

/**
 * Toggle the tools column CSS class which hides non-context tools.
 *
 * @param {boolean} state Toggle state of tools column class
 */
ve.init.mw.CXTarget.prototype.toggleContextTools = function ( state ) {
	this.complexDialogOpened = state;

	this.translationView.toolsColumn.toolContainer.$element.toggleClass( 'cx-column-tools-container--dialog', state );
};

ve.init.mw.CXTarget.prototype.getTranslation = function () {
	return this.translation;
};

ve.init.mw.CXTarget.prototype.onDialogOpening = function ( context, dialog ) {
	var headerHeight, scrollPosition;

	this.contextStack.push( context );
	context.connect( this, { afterContextChange: [ 'processContextItems', true ] } );
	this.processContextItems( true );

	if ( !( dialog instanceof ve.ui.NodeDialog ) ) {
		return;
	}

	// We can use setSize( 'full' ) method here and it would work for some dialogs,
	// like reference dialog, but VE hardcodes the size for media dialog in
	// ve.ui.MWMediaDialog.prototype.switchPanels.
	// See T198390
	dialog.getSize = function () { return 'full'; };

	// Don't cover the top header with overlay when the user is at the top of the viewport
	// See T193587
	headerHeight = this.translationView.header.$element.outerHeight();
	scrollPosition = $( this.getElementWindow() ).scrollTop();

	if ( scrollPosition === 0 ) {
		dialog.$element.css( 'top', headerHeight );
	} else {
		dialog.$element.css( 'top', '' );
	}
};

ve.init.mw.CXTarget.prototype.onDialogClosing = function () {
	this.processContextItems( false );
	this.contextStack.pop();
};

/**
 * Process the stack of contexts, with their context items. Stack contains contexts
 * for nested modal dialogs, e.g. opening reference dialog, for a reference that
 * has a template, and then opening the template dialog.
 *
 * The logic when dialog is opening is to hide context item(s) for all but last
 * context inside a stack. Item(s) for last context are disabled.
 *
 * On the other side, when dialog is closing, context item(s) of last context are
 * enabled and visible, while context item(s) for second-to-last context are
 * disabled and visible. Item(s) for all other contexts are just toggled invisible.
 *
 * @param {boolean} disabled True if context items need to be disabled
 */
ve.init.mw.CXTarget.prototype.processContextItems = function ( disabled ) {
	var process, lastItem = this.contextStack.length - 1;

	// Iterate all context(s) in a stack
	this.contextStack.forEach( function ( context, index ) {
		// Whether items for second to last context in a stack should be disabled.
		// Used when dialog is closing.
		var disableSecondToLast = !disabled && index === ( lastItem - 1 );

		// If item is last (during opening) or second-to-last (during closing)
		if ( index === lastItem || disableSecondToLast ) {
			process = function ( item ) {
				item.toggle( true );
				item.setDisabled( disabled || disableSecondToLast );
				// Set disabled state for action buttons
				item.actionButtons.getItems().forEach( function ( button ) {
					button.setDisabled( disabled || disableSecondToLast );
				} );
			};
		} else {
			process = function ( item ) {
				item.toggle( false );
			};
		}

		context.getItems().forEach( process );
	} );
};

ve.init.mw.CXTarget.prototype.onTargetTitleChange = function () {
	this.pageName = this.translationView.targetColumn.getTitle();
	this.updateNamespace();
	this.emit( 'targetTitleChange' );
	this.debounceAlignSectionPairs();
};

ve.init.mw.CXTarget.prototype.enablePublishButton = function () {
	if ( this.translation.hasTranslatedSections() ) {
		this.publishButton.setDisabled( false );
	}
};

/**
 * Translation restore event handler
 * @param {mw.cx.dm.Translation} translationModel
 */
ve.init.mw.CXTarget.prototype.onTranslationRestore = function () {
	if ( mw.Title.newFromText( this.pageName ) ) {
		this.enablePublishButton();
	}

	// Update publish settings namespace choice
	this.updateNamespace();
};

/**
 * Call this when translation editor is ready.
 */
ve.init.mw.CXTarget.prototype.onSurfaceReady = function () {
	// Update namespace tools
	this.updateNamespace();
};

/**
 * Call this whenever something changes in the translation that requires saving.
 */
ve.init.mw.CXTarget.prototype.onChange = function () {
	if ( mw.Title.newFromText( this.pageName ) && !this.errorsInTranslation ) {
		this.publishButton.setDisabled( false );
	}
	this.translationView.clearMessages();
};

/**
 * Target namespace change handler
 * @param {number} namespaceId
 */
ve.init.mw.CXTarget.prototype.onPublishNamespaceChange = function ( namespaceId ) {
	var newTitle = mw.cx.getTitleForNamespace( this.pageName, namespaceId );
	// Setting title in targetColumn will take care of necessary event firing for title change.
	this.translationView.targetColumn.setTitle( newTitle );
	mw.log( '[CX] Target title changed to ' + newTitle );
	this.updateNamespace();
};

ve.init.mw.CXTarget.prototype.updateNamespace = function () {
	this.getActions().updateToolState();
};

ve.init.mw.CXTarget.prototype.getPublishNamespace = function () {
	var titleObj = mw.Title.newFromText( this.pageName );

	return titleObj ? titleObj.getNamespaceId() : mw.cx.getDefaultTargetNamespace();
};

ve.init.mw.CXTarget.prototype.onPublishButtonClick = function () {
	// Disable the trigger button
	this.publishButton.setDisabled( true )
		.setLabel( mw.msg( 'cx-publish-button-publishing' ) );
	this.targetSurface.setDisabled( true );
	this.translationView.contentContainer.$element.toggleClass( 'oo-ui-widget-disabled', true );
	this.emit( 'publish' );
	this.updateNamespace();
};

ve.init.mw.CXTarget.prototype.attachToolbar = function () {
	this.translationView.toolsColumn.editingToolbarContainer.$element.append(
		this.getToolbar().$element
			.addClass( 'oo-ui-toolbar-narrow' ) // Quick fix to avoid overflowing toolbar.
	);

	ve.ui.CXTranslationToolbar.static.registerTools( this.MTManager ).then( function () {
		var mtToolbar = new ve.ui.CXTranslationToolbar();
		mtToolbar.setup( this.constructor.static.translationToolbarGroups, this.targetSurface );
		this.translationView.toolsColumn.mtToolbarContainer.$element.append( mtToolbar.$element );
		mtToolbar.initialize();
	}.bind( this ) );
};

ve.init.mw.CXTarget.prototype.onDocumentTransact = function () {
	this.emit( 'contentChange' );
	this.debounceAlignSectionPairs();
};

/**
 * Set the height for both title widgets to whichever
 * is the bigger height between source and target titles.
 */
ve.init.mw.CXTarget.prototype.alignTitles = function () {
	var height,
		sourceTitleWidget = this.translationView.sourceColumn.getTitleWidget().$element,
		targetTitleWidget = this.translationView.targetColumn.getTitleWidget().$element;

	sourceTitleWidget.css( 'min-height', '' );
	targetTitleWidget.css( 'min-height', '' );

	height = Math.max(
		sourceTitleWidget.outerHeight(),
		targetTitleWidget.outerHeight()
	);

	sourceTitleWidget.css( 'min-height', height );
	targetTitleWidget.css( 'min-height', height );
};

ve.init.mw.CXTarget.prototype.alignSectionPairs = function () {
	var i, sourceDocumentNode, targetDocumentNode, sourceOffsetTop, targetOffsetTop,
		documentNodeChildren, alignSectionPair, articleNode;

	sourceDocumentNode = this.sourceSurface.getView().getDocument().getDocumentNode();
	targetDocumentNode = this.targetSurface.getView().getDocument().getDocumentNode();

	// This method can be called before restoration is complete and all nodes are attached
	// to the DOM (e.g. via mw.cx.ui.TargetColumn#setTitle). If so, skip aligment.
	if (
		!document.contains( sourceDocumentNode.$element[ 0 ] ) ||
		!document.contains( targetDocumentNode.$element[ 0 ] )
	) {
		return;
	}

	this.alignTitles();

	sourceOffsetTop = sourceDocumentNode.$element.offset().top;
	targetOffsetTop = targetDocumentNode.$element.offset().top;
	documentNodeChildren = sourceDocumentNode.getChildren();

	for ( i = 0; i < documentNodeChildren.length; i++ ) {
		if ( documentNodeChildren[ i ].getType() === 'article' ) {
			articleNode = documentNodeChildren[ i ];
			break;
		}
	}

	if ( !articleNode ) {
		mw.log.error( '[CX] Fatal: articleNode not found in documentNode' );
		return;
	}

	alignSectionPair = this.translationView.constructor.static.alignSectionPair;
	articleNode.getChildren().forEach( function ( node ) {
		var sectionNumber,
			element = node.$element[ 0 ],
			id = element && element.id,
			match = id && id.match( /^cxSourceSection([0-9]+)$/ );
		if ( match ) {
			sectionNumber = +match[ 1 ];
			alignSectionPair( sourceOffsetTop, targetOffsetTop, sectionNumber );
		} else {
			mw.log.warn( '[CX] Invalid source section ' + id + ' found. Alignment may go wrong' );
		}
	} );
};

/**
 * Get the jQuery element for the given source section id.
 *
 * @param {string} sectionId Section id. E.g. cxSourceSection15 or cxTargetSection15
 * @return {jQuery} Source section element
 */
ve.init.mw.CXTarget.prototype.getSourceSectionElement = function ( sectionId ) {
	var sectionNumber, sourceId;

	sectionNumber = mw.cx.getSectionNumberFromSectionId( sectionId );
	sourceId = 'cxSourceSection' + sectionNumber;
	return this.sourceSurface.$element.find( '#' + sourceId );
};

/**
 * Get the source node for the given section id. Accepts section id for source or target.
 *
 * @param {string} sectionId Section id. Example cxSourceSection15 or cxTargetSection15
 * @return {ve.dm.CXSectionNode}
 */
ve.init.mw.CXTarget.prototype.getSourceSectionNode = function ( sectionId ) {
	return this.getSourceSectionElement( sectionId ).data( 'view' ).getModel();
};

/**
 * Get the translation node for the given section id. Accepts section id of source or target.
 * @param  {string} sectionId Section id. Example cxSourceSection15 or cxTargetSection15
 * @return {ve.dm.CXSectionNode|null}
 */
ve.init.mw.CXTarget.prototype.getTargetSectionNode = function ( sectionId ) {
	var sectionNumber, targetId, view;

	sectionNumber = mw.cx.getSectionNumberFromSectionId( sectionId );
	targetId = 'cxTargetSection' + sectionNumber;
	view = this.targetSurface.$element.find( '#' + targetId ).data( 'view' );
	return view ? view.getModel() : null;
};

/**
 * Get the content editable node for the given section number. Accepts section id for target.
 *
 * @param {string} sectionNumber Section number. Example 4, 5 etc.
 * @return {ve.ce.CXSectionNode|null}
 */
ve.init.mw.CXTarget.prototype.getTargetSectionElementFromSectionNumber = function ( sectionNumber ) {
	var targetId = 'cxTargetSection' + sectionNumber,
		view = this.targetSurface.$element.find( '#' + targetId ).data( 'view' );

	return !view ? null : view;
};

/**
 * Get the translation node for the given section number. Accepts section id of source or target.
 *
 * @param  {string} sectionNumber Section number. Example 4, 5 etc.
 * @return {ve.dm.CXSectionNode}
 */
ve.init.mw.CXTarget.prototype.getTargetSectionNodeFromSectionNumber = function ( sectionNumber ) {
	var view = this.getTargetSectionElementFromSectionNumber( sectionNumber );
	return view ? view.getModel() : null;
};

/**
 * Handle clicks for placeholder sections.
 * @param {ve.ce.CXPlaceholderNode} placeholder
 */
ve.init.mw.CXTarget.prototype.onDocumentActivatePlaceholder = function ( placeholder ) {
	var $sourceElement, model,
		cxid = placeholder.getModel().getAttribute( 'cxid' );

	model = placeholder.getModel();
	model.emit( 'beforeTranslation' );
	this.MTManager.getPreferredProvider().then( function ( provider ) {
		return this.changeContentSource( model, null, provider );
	}.bind( this ) ).fail( function () {
		mw.notify( 'Automatic translation failed!' );
		return this.MTManager.getDefaultNonMTProvider().then( function ( provider ) {
			return this.changeContentSource( model, null, provider );
		}.bind( this ) );
	}.bind( this ) ).always( function () {
		var model;
		$sourceElement = this.getSourceSectionElement( cxid );
		$sourceElement.removeClass( 'cx-section-highlight' );
		model = this.getTargetSectionNode( cxid );
		if ( model ) {
			model.emit( 'afterTranslation' );
		} else {
			mw.log.error( '[CX] No model found after translation for ' + cxid );
		}
	}.bind( this ) );
};

ve.init.mw.CXTarget.prototype.onPublishCancel = function () {
	this.publishButton.setDisabled( false ).setLabel( mw.msg( 'cx-publish-button' ) );
	this.targetSurface.setDisabled( false );
	this.updateNamespace();
	this.translationView.contentContainer.$element.toggleClass( 'oo-ui-widget-disabled', false );
};

ve.init.mw.CXTarget.prototype.onPublishSuccess = function () {
	this.translationView.showMessage(
		'success',
		mw.message( 'cx-publish-page-success',
			$( '<a>' ).attr( {
				href: mw.util.getUrl( this.translation.getTargetTitle() ),
				target: '_blank'
			} ).text( this.translation.getTargetTitle() )[ 0 ].outerHTML
		)
	);
	this.publishButton.setDisabled( true ).setLabel( mw.msg( 'cx-publish-button' ) );
	this.targetSurface.setDisabled( false );
	this.updateNamespace();
	this.translationView.contentContainer.$element.toggleClass( 'oo-ui-widget-disabled', false );
};

ve.init.mw.CXTarget.prototype.onPublishFailure = function ( errorMessage ) {
	this.translationView.showMessage( 'error', errorMessage );
	this.publishButton.setDisabled( false ).setLabel( mw.msg( 'cx-publish-button' ) );
	this.targetSurface.setDisabled( false );
	this.updateNamespace();
	this.translationView.contentContainer.$element.toggleClass( 'oo-ui-widget-disabled', false );
};

/**
 * @param {boolean} hasErrors True if any of the issues is error, false if all are warnings.
 */
ve.init.mw.CXTarget.prototype.onTranslationIssues = function ( hasErrors ) {
	this.errorsInTranslation = hasErrors;

	if ( !hasErrors ) {
		this.enablePublishButton();
	}
};

ve.init.mw.CXTarget.prototype.onIssuesResolved = function () {
	this.errorsInTranslation = false;
	this.enablePublishButton();
};

/**
 * Set the section content to the given content.
 * @param {ve.dm.CXSectionNode|ve.dm.CXPlaceholderNode} section Section model
 * @param {string} content
 * @param {string} source Original content source
 */
ve.init.mw.CXTarget.prototype.setSectionContent = function ( section, content, source ) {
	var pasteDoc, newCursorRange, newRange, tx, docLen,
		surfaceModel = this.getSurface().getModel(),
		doc = surfaceModel.getDocument(),
		cxid = section.getTranslationUnitId(),
		fragment = surfaceModel.getLinearFragment( section.getOuterRange(), true /* noAutoSelect */ );

	/**
	 * Fix internal list indexes for duplicated references in a newFromDocumentInsertion transaction.
	 *
	 * This finds references inserted by the transaction that are duplicates of references already
	 * present in the document, and changes them to point to the existing internal list item.
	 *
	 * This is a super hacky way to prevent errors in VE due to name collisions for duplicated
	 * references.
	 *
	 * @param {ve.dm.Transaction} tx Transaction generated by newFromDocumentInsertion()
	 * @param {ve.dm.Document} doc Document the transaction is intended for
	 */
	function deduplicateReferences( tx, doc ) {
		var o, i, element, nodeGroup, kinNodes;
		for ( o = 0; o < tx.operations.length; o++ ) {
			if ( tx.operations[ o ].type !== 'replace' ) {
				continue;
			}
			for ( i = 0; i < tx.operations[ o ].insert.length; i++ ) {
				element = tx.operations[ o ].insert[ i ];
				if ( element.type !== 'mwReference' ) {
					continue;
				}
				// Find any existing references this reference is a duplicate of
				nodeGroup = doc.getInternalList().getNodeGroup( element.attributes.listGroup );
				kinNodes = nodeGroup && nodeGroup.keyedNodes[ element.attributes.listKey ];
				if ( kinNodes && kinNodes.length > 0 ) {
					// This reference is a duplicate. Point it to the existing interal list item
					element.attributes.listIndex = kinNodes[ 0 ].getAttribute( 'listIndex' );
					// Only the first reference in the group should have contentsUsed=true
					element.attributes.contentsUsed = false;
				}
			}
		}
	}

	pasteDoc = ve.dm.converter.getModelFromDom( ve.createDocumentFromHtml( content ) );
	docLen = pasteDoc.getInternalList().getListNode().getOuterRange().start;

	fragment.insertContent( [
		{ type: 'cxSection', attributes: { style: 'section', cxid: cxid, cxsource: source } },
		// Put a temporary paragraph inside the section so the cursor has somewhere
		// sensible to go, preventing scrollCursorIntoView from triggering a jump
		{ type: 'paragraph' },
		{ type: '/paragraph' },
		{ type: '/cxSection' }
	] );
	fragment = fragment
		.collapseToStart().adjustLinearSelection( 1, 3 )
		.removeContent();

	tx = ve.dm.TransactionBuilder.static.newFromDocumentInsertion(
		doc,
		fragment.getSelection().getCoveringRange().start,
		pasteDoc,
		new ve.Range( 1, docLen - 1 )
	);
	// HACK: modify the internal list indexes of any reused references being inserted to avoid errors in VE
	// If we don't do this, a reused reference will bring along a second copy of its internal list item,
	// and VE will crash because there are two references with the same name but pointing to different
	// internal list items.
	// We have to perform these modifications after generating the transaction, because if we do it before,
	// our modified indexes will be corrupted by the remapping step in newFromDocumentInsertion().
	deduplicateReferences( tx, doc );
	newRange = tx.getModifiedRange( doc );
	surfaceModel.change( tx, new ve.dm.LinearSelection( doc, newRange ) );

	// Select first content offset within new content
	newCursorRange = new ve.Range( surfaceModel.getDocument().data.getNearestContentOffset( newRange.start, 1 ) );
	if ( newRange.containsRange( newCursorRange ) ) {
		surfaceModel.setLinearSelection( newCursorRange );
	}
};

/**
 * @inheritDoc
 */
ve.init.mw.CXTarget.prototype.getContentApi = function ( doc, options ) {
	doc = doc || this.targetSurface.getModel().getDocument();
	return this.siteMapper.getApi( doc.getLang(), options );
};

/**
 * @inheritDoc
 */
ve.init.mw.CXTarget.prototype.getPageName = function ( doc ) {
	doc = doc || this.targetSurface.getModel().getDocument();
	return doc.getLang() === this.translation.getSourceLanguage() ?
		this.translation.getSourceTitle() : this.translation.getTargetTitle();
};

/**
 * Translate and adapt the source section for the given section id.
 * @param {string} sectionId SectionId
 * @param {string} provider Machine translation privider
 * @return {jQuery.Promise}
 */
ve.init.mw.CXTarget.prototype.translateSection = function ( sectionId, provider ) {
	var sourceNode,
		sourceNodeModel = this.getSourceSectionNode( sectionId );

	// Convert DOM to node, preserving full internal list
	// Use clipboard mode to ensure reference body is outputted
	sourceNode = ve.dm.converter.getDomFromNode( sourceNodeModel, true ).body.children[ 0 ];

	function restructure( section ) {
		section = section.cloneNode( true );
		section.removeAttribute( 'rel' );
		section.id = 'cxTargetSection' + mw.cx.getSectionNumberFromSectionId( sectionId );
		// TODO: it's horrible that id attributes get duplicated
		// $( section ).find( '[id]' ).each( function ( i, node ) {
		// 	node.setAttribute( 'id', 'cx' + node.getAttribute( 'id' ) );
		// } );
		return section;
	}
	return this.MTService.translate( restructure( sourceNode ).outerHTML, provider );
};

/**
 * Change content source for given target section.
 *
 * This handles caching of previous content when switching back and forth.
 * This might be redundant with undo/redo.
 *
 * @param {ve.dm.CXSectionNode|ve.dm.CXPlaceholderNode} section
 * @param {string|null} previousProvider
 * @param {string} newProvider
 * @param {Object} options
 * @cfg {boolean} noCache Do not use cached version
 * @return {jQuery.promise}
 */
ve.init.mw.CXTarget.prototype.changeContentSource = function (
	section,
	previousProvider,
	newProvider,
	options
) {
	var cxid, html, cachedContent;

	options = options || {};
	cxid = section.getTranslationUnitId();
	html = ve.dm.converter.getDomFromNode( section, true ).body.children[ 0 ].outerHTML;

	if ( previousProvider !== null ) {
		OO.setProp( this.contentSourceCache, cxid, previousProvider, html );
	}

	if ( !options.noCache ) {
		cachedContent = OO.getProp( this.contentSourceCache, cxid, newProvider );

		if ( cachedContent ) {
			this.setSectionContent( section, cachedContent, newProvider );
			return $.Deferred().resolve().promise();
		}
	}

	return this.translateSection( cxid, newProvider ).then( function ( content ) {
		this.setSectionContent( section, content, newProvider );
	}.bind( this ) );
};

/* Registration */

ve.init.mw.targetFactory.register( ve.init.mw.CXTarget );
