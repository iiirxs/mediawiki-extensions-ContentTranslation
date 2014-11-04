/**
 * ContentTranslation Tools
 * A tool that allows editors to translate pages from one language
 * to another with the help of machine translation and other translation tools
 *
 * @file
 * @ingroup Extensions
 * @copyright See AUTHORS.txt
 * @license GPL-2.0+
 */
( function ( $, mw ) {
	'use strict';

	/**
	 * CXSourceSelector
	 * @class
	 */
	function CXSourceSelector( $trigger, options ) {
		this.$trigger = $( $trigger );
		this.options = $.extend( {}, options );
		// @todo Refactor
		this.siteMapper = mw.cx.siteMapper;

		this.$dialog = null;
		this.languagePairs = null;
		this.sourceLanguages = [];
		this.targetLanguages = [];
		this.$sourceLanguage = null;
		this.$targetLanguage = null;
		this.sourceLanguage = null;
		this.targetLanguage = null;
		this.init();
	}

	/**
	 * Initialize the plugin.
	 */
	CXSourceSelector.prototype.init = function () {
		var cxSourceSelector = this;
		this.getLanguagePairs().then( function () {
			cxSourceSelector.render();
			cxSourceSelector.listen();
		} );

	};

	/**
	 * Get all the source and target languages.
	 * @return {jQuery.Promise}
	 */
	CXSourceSelector.prototype.getLanguagePairs = function () {
		var languagePairsAPIUrl, cxSourceSelector = this;

		languagePairsAPIUrl = this.siteMapper.getCXServerUrl( '/languagepairs' );

		return $.get( languagePairsAPIUrl )
			.done( function ( response ) {
				var sourceLanguage, i,
					targetLanguages = [];

				cxSourceSelector.languagePairs = response;
				for ( sourceLanguage in cxSourceSelector.languagePairs ) {
					cxSourceSelector.sourceLanguages.push( sourceLanguage );
					$.merge( targetLanguages, cxSourceSelector.languagePairs[ sourceLanguage ] );
				}

				if ( !cxSourceSelector.targetLanguages ) {
					cxSourceSelector.targetLanguages = [];
				}

				// Make the target languages array unique
				targetLanguages = targetLanguages.sort();
				for ( i = 0; i < targetLanguages.length; i++ ) {
					if ( targetLanguages[ i ] !== targetLanguages[ i - 1 ] ) {
						cxSourceSelector.targetLanguages.push( targetLanguages[ i ] );
					}
				}
			} )
			.fail( function ( response ) {
				mw.log(
					'Error getting language pairs from ' + languagePairsAPIUrl + ' . ' +
					response.statusText + ' (' + response.status + '). ' +
					response.responseText
				);
			} );
	};

	/**
	 * Fill the target language dropdown with target languages that have
	 * language tools compatible with the source language.
	 */
	CXSourceSelector.prototype.fillTargetLanguages = function () {
		var index, targetLanguage, $option,
			sourceLanguage = this.$sourceLanguage.val(),
			enabledOptions = [],
			disabledOptions = [];

		this.$targetLanguage.empty();
		for ( index in this.targetLanguages ) {
			targetLanguage = this.targetLanguages[ index ];

			// Skip the same language
			if ( targetLanguage === sourceLanguage ) {
				continue;
			}

			$option = $( '<option>' )
				.attr( 'value', targetLanguage )
				.text( $.uls.data.getAutonym( targetLanguage ) );

			if ( $.inArray( targetLanguage, this.languagePairs[ sourceLanguage ] ) > -1 ) {
				enabledOptions.push( $option );
			} else {
				// Disable the option, but show it so the user will
				// know that this language is is in the system
				$option.attr( 'disabled', true );
				disabledOptions.push( $option );
			}
		}

		// Show the enabled languages first
		this.$targetLanguage.append( enabledOptions, disabledOptions );
	};

	/**
	 * Listen for events.
	 */
	CXSourceSelector.prototype.listen = function () {
		var selector = this;

		// Open or close the dialog when clicking the link.
		// The dialog will be unitialized until the first click.
		this.$trigger.click( $.proxy( this.show, this ) );

		this.$sourceTitleInput.on( 'input', $.debounce( 100, false, function () {
			selector.sourceLanguage = selector.$sourceLanguage.val();
			selector.searchTitles( selector.sourceLanguage, $( this ).val() ).done( function ( response ) {
				var i, len, suggestions = response[ 1 ];
				selector.$titleList.empty();
				if ( suggestions.length ) {
					for ( i = 0, len = suggestions.length; i < len; i++ ) {
						selector.$titleList.append( $( '<option>' ).attr( 'value', suggestions[ i ] ) );
					}
				}
			} );
		} ) );

		this.$sourceLanguage.on( 'change', $.proxy( this.fillTargetLanguages, this ) );
	};

	/**
	 * Show the CXSourceSelector dialog
	 */
	CXSourceSelector.prototype.show = function () {
		this.$dialog.removeClass( 'hidden' );
		this.position();
	};

	/**
	 * Position the CXSourceSelector dialog.
	 */
	CXSourceSelector.prototype.position = function () {
		var dialogTop, dialogLeft,
			dir = $( 'html' ).prop( 'dir' );

		// The default is to place the dialog near the element that triggers it
		dialogTop = this.options.top || this.$trigger.offset().top;
		dialogLeft = this.options.left || this.$trigger.offset().left;

		if ( dir === 'rtl' ) {
			dialogLeft = dialogLeft - this.$dialog.width();
		}

		this.$dialog.css( {
			top: dialogTop,
			left: dialogLeft
		} );
	};

	/**
	 * Provides titles for autocompletion from given wiki.
	 * @param {string} language
	 * @param {string} input
	 * @return {jQuery.Deferred}
	 */
	CXSourceSelector.prototype.searchTitles = function ( language, input ) {
		var api = this.siteMapper.getApi( language );

		return api.get( {
			action: 'opensearch',
			search: input,
			namespace: 0,
			suggest: true,
			format: 'json'
		}, {
			dataType: 'jsonp',
			// This prevents warnings about the unrecognized parameter "_"
			cache: true
		} );
	};

	/**
	 * Hide the entry point dialog.
	 */
	CXSourceSelector.prototype.hide = function () {
		this.$dialog.addClass( 'hidden' );
	};

	/**
	 * Start a new page translation in Special:CX
	 */
	CXSourceSelector.prototype.startPageInCX = function () {
		location.href = this.siteMapper.getCXUrl(
			this.$sourceTitleInput.val(),
			this.$targetTitleInput.val(),
			this.$sourceLanguage.val(),
			this.$targetLanguage.val()
		);
	};

	/**
	 * Render the CXSourceSelector dialog.
	 */
	CXSourceSelector.prototype.render = function () {
		var $actions,
			$sourceLanguageLabel,
			$heading, $targetLanguageLabel,
			$sourceInputs, $targetInputs,
			index;

		this.$dialog = $( '<div>' )
			.addClass( 'cx-sourceselector-dialog hidden' );

		$heading = $( '<div>' ).addClass( 'cx-sourceselector-dialog__heading' )
			.text( mw.msg( 'cx-sourceselector-dialog-new-translation' ) );

		$sourceLanguageLabel = $( '<label>' ).addClass( 'cx-sourceselector-dialog__language-label' )
			.text( mw.msg( 'cx-sourceselector-dialog-source-language-label' ) );

		this.$sourceLanguage = $( '<select>' )
			.addClass( 'cx-sourceselector-dialog__language' )
			.text( $.uls.data.getAutonym( mw.config.get( 'wgContentLanguage' ) ) );
		for ( index in this.sourceLanguages ) {
			this.$sourceLanguage.append( $( '<option>' )
				.attr( 'value', this.sourceLanguages[ index ] )
				.text( $.uls.data.getAutonym( this.sourceLanguages[ index ] ) )
			);
		}

		$targetLanguageLabel = $( '<label>' ).addClass( 'cx-sourceselector-dialog__language-label' )
			.text( mw.msg( 'cx-sourceselector-dialog-target-language-label' ) );
		this.$targetLanguage = $( '<select>' )
			.addClass( 'cx-sourceselector-dialog__language' )
			.text( $.uls.data.getAutonym( mw.config.get( 'wgContentLanguage' ) ) );

		this.fillTargetLanguages();

		this.$sourceTitleInput = $( '<input>' )
			.addClass( 'cx-sourceselector-dialog__title' )
			.attr( {
				name: 'sourceTitle',
				type: 'search',
				list: 'searchresults'
			} );
		this.$targetTitleInput = $( '<input>' )
			.addClass( 'cx-sourceselector-dialog__title' )
			.attr( {
				name: 'targetTitle'
			} );

		this.$titleList = $( '<datalist>' ).prop( 'id', 'searchresults' );
		$sourceInputs = $( '<div>' )
			.addClass( 'cx-sourceselector-dialog__source-inputs' )
			.append( $sourceLanguageLabel,
				this.$sourceLanguage,
				this.$sourceTitleInput
		);
		$targetInputs = $( '<div>' )
			.addClass( 'cx-sourceselector-dialog__target-inputs' )
			.append(
				$targetLanguageLabel,
				this.$targetLanguage,
				this.$targetTitleInput
		);

		this.$translateFromButton = $( '<button>' )
			.addClass( 'mw-ui-button mw-ui-progressive cx-sourceselector-dialog__button-translate' )
			.text( mw.msg( 'cx-sourceselector-dialog-button-start-translation' ) )
			.click( $.proxy( this.startPageInCX, this ) );

		$actions = $( '<div>' ).addClass( 'cx-sourceselector-dialog__actions' )
			.append( this.$translateFromButton );

		this.$dialog.append( $heading,
			$sourceInputs,
			$targetInputs,
			$actions,
			this.$titleList
		);

		$( 'body' ).append( this.$dialog );
	};

	/**
	 * CXEntryPoint Plugin
	 */
	$.fn.cxSourceSelector = function ( options ) {
		return this.each( function () {
			var $this = $( this ),
				data = $this.data( 'cxsourceselector' );

			if ( !data ) {
				$this.data( 'cxsourceselector', ( data = new CXSourceSelector( this, options ) ) );
			}
		} );
	};

	$( function () {
		mw.hook( 'mw.cx.source.select' ).add( function () {
			var $container = $( '.cx-widget__columns' );

			$container.empty().cxSourceSelector( {
				top: '150px',
				left: '33%'
			} ).click();
		} );
	} );
}( jQuery, mediaWiki ) );
