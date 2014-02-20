/**
 * ContentTranslation Tools
 * A tool that allows editors to translate pages from one language
 * to another with the help of machine translation and other translation aids
 *
 * @file
 * @ingroup Extensions
 * @copyright See AUTHORS.txt
 * @license GPL-2.0+
 */
( function ( $, mw ) {
	'use strict';

	/**
	 * ContentTranslationSource
	 *
	 * @class
	 */
	function ContentTranslationSource( element, options ) {
		this.$container = $( element );
		this.options = $.extend( true, {}, $.fn.cxSource.defaults, options );
		this.$title = null;
		this.$content = null;
		this.init();
	}

	ContentTranslationSource.prototype.init = function () {
		mw.cx.sourceTitle = new mw.Uri().query.page;
		this.render();
		this.load();
		this.listen();
	};

	ContentTranslationSource.prototype.render = function () {
		mw.cx.sourceLanguage = mw.config.get( 'wgContentLanguage' );

		this.$container.prop( {
			lang: mw.cx.sourceLanguage,
			dir: $.uls.data.getDir( mw.cx.sourceLanguage )
		} );

		this.$container.append(
			$( '<h2>' )
				.addClass( 'cx-column__title' )
				.text( mw.cx.sourceTitle )
		);

		this.$container.append(
			$( '<div>' )
				.addClass( 'cx-column__sub-heading' )
				.append(
					$( '<span>' )
						.addClass( 'cx-column__language-label' )
						.text( $.uls.data.getAutonym( mw.cx.sourceLanguage ) ),
					$( '<span>' )
						.addClass( 'cx-column__sub-heading__view-page' )
						.html(
							mw.message(
								'cx-source-view-page',
								mw.util.getUrl( mw.cx.sourceTitle )
							).parse()
						)
				)
		);

		this.$container.append(
			$( '<div>' )
				.addClass( 'cx-column__content' )
				.text( mw.msg( 'cx-source-loading', mw.cx.sourceTitle ) )
		);
		this.$title = this.$container.find( '.cx-column__title' );
		this.$content = this.$container.find( '.cx-column__content' );
	};

	ContentTranslationSource.prototype.load = function () {
		var api = new mw.Api(),
			cxSource = this;

		api.get( {
			action: 'parse',
			page: mw.cx.sourceTitle,
			disablepp: true
		} ).done( function ( result ) {
			cxSource.$title.html( result.parse.title );
			cxSource.$content.html( result.parse.text['*'] );
		} );
	};

	ContentTranslationSource.prototype.listen = function () {
		// Empty for now
	};

	$.fn.cxSource = function ( options ) {
		return this.each( function () {
			var $this = $( this ),
				data = $this.data( 'cxSource' );

			if ( !data ) {
				$this.data(
					'cxSource',
					( data = new ContentTranslationSource( this, options ) )
				);
			}

			if ( typeof options === 'string' ) {
				data[options].call( $this );
			}
		} );
	};

	$.fn.cxSource.defaults = {};
}( jQuery, mediaWiki ) );
