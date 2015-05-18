/**
 * Content Translation invitation from the 'contributions' link in pages.
 *
 * @file
 * @copyright See AUTHORS.txt
 * @license GPL-2.0+
 */
( function ( $, mw ) {
	'use strict';

	var campaign = 'contributionsmenu';

	function isPageCreation() {
		var uri = mw.Uri();

		return mw.config.get( 'wgArticleId' ) === 0 &&
			mw.config.get( 'wgNamespaceNumber' ) === 0 &&
			( mw.config.get( 'wgAction' ) === 'edit' || uri.query.veaction === 'edit' );
	}

	function getTranslationsItem() {
		var cxUrlParams,
			message, $pageTitle, $expansion,
			cxUrl, $link, $item;

		cxUrlParams = {
			campaign: campaign,
			to: mw.config.get( 'wgContentLanguage' )
		};

		if ( isPageCreation() ) {
			message = 'cx-campaign-contributionsmenu-translate-instead';
			$pageTitle = $( '<em>' )
				.text( mw.msg( 'quotation-marks', mw.config.get( 'wgTitle' ) ) );

			$expansion = $( '<div>' )
				.addClass( 'cx-campaign-contributionsmenu__expansion' )
				.html( mw.msg(
					'cx-campaign-contributionsmenu-might-be-available',
					$pageTitle[ 0 ].outerHTML
				) );

			cxUrlParams.targettitle = mw.config.get( 'wgTitle' );
		} else {
			message = 'cx-campaign-contributionsmenu-mytranslations';
			$expansion = $( [] );
		}

		cxUrl = mw.util.getUrl( 'Special:ContentTranslation', cxUrlParams );

		$link = $( '<a>' )
			.text( mw.msg( message ) )
			.append( $expansion )
			.attr( 'href', cxUrl );

		$item = $( '<li>' )
			.addClass( 'cx-campaign-translations' )
			.append( $link );

		return $item;
	}

	function showInvitation() {
		var $trigger,
			$myContributions, $myTranslations, $myUploads,
			$menu, callout;

		$trigger = $( '#pt-mycontris a' );

		$myContributions = $( '<li>' )
			.addClass( 'cx-campaign-contributions' )
			.append( $( '<a>' )
				.text( mw.msg( 'cx-campaign-contributionsmenu-mycontributions' ) )
				.attr( 'href', $trigger.attr( 'href' ) )
			);

		$myTranslations = getTranslationsItem();

		if ( $( '.mw-special-Preferences' ).length ) {
			$myTranslations.addClass( 'cx-campaign-new-beta-feature' );
		}

		$myUploads = $( '<li>' )
			.addClass( 'cx-campaign-uploads' )
			.append( $( '<a>' )
				.text( mw.msg( 'cx-campaign-contributionsmenu-myuploads' ) )
				.attr( 'href', '//commons.wikimedia.org/wiki/Special:MyUploads' )
			);

		$menu = $( '<ul>' )
			.append( $myContributions, $myTranslations, $myUploads );

		$trigger.callout( {
			trigger: 'hover',
			classes: 'cx-campaign-contributionsmenu',
			direction: $.fn.callout.autoDirection( '1' ),
			content: $menu
		} );

		callout = $trigger.data( 'callout' );

		mw.hook( 'mw.cx.betafeature.enabled' ).add( function () {
			// Show after a few milliseconds to get all position calculation correct
			setTimeout( function () {
				callout.show();
			}, 500 );
			mw.hook( 'mw.cx.cta.shown' ).fire( campaign );
		} );

	}

	$( function () {
		var blacklist = mw.config.get( 'wgContentTranslationBrowserBlacklist' );

		if ( !$.client.test( blacklist, null, true ) ) {
			showInvitation();

			// Show it after creating a new article using VE
			mw.hook( 've.activationComplete' ).add( function () {
				var $trigger;

				$trigger = $( '#pt-mycontris a' );
				$trigger.data( 'callout' ).$dialog.find( 'li.cx-campaign-translations' )
					.replaceWith( getTranslationsItem() );
			} );
		}
	} );
}( jQuery, mediaWiki ) );
