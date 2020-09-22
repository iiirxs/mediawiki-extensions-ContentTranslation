/*!
 * ContentTranslation - Link articles using Wikibase
 *
 * @copyright See AUTHORS.txt
 * @license GPL-2.0-or-later
 */
/* global wikibase */
( function ( $, mw ) {
	'use strict';

	/**
	 * Link the source and target articles in the Wikibase repo
	 * @param {string} sourceLanguage
	 * @param {string} targetLanguage
	 * @param {string} sourceTitle
	 * @param {string} targetTitle
	 */
	var addWikibaseLink = function ( sourceLanguage, targetLanguage, sourceTitle, targetTitle ) {
		var title, sourceApi;

		// Link only pages in the main space
		title = new mw.Title( targetTitle );
		if ( title.getNamespaceId() !== 0 ) {
			return;
		}

		sourceApi = mw.cx.siteMapper.getApi( mw.cx.sourceLanguage );

		// TODO: Use action=query&meta=wikibase API
		// that expose siteid as per
		// https://gerrit.wikimedia.org/r/#/c/214517/
		sourceApi.get( {
			action: 'query',
			meta: 'siteinfo',
			siprop: 'general'
		} ).done( function ( result ) {
			var repoApi, targetWikiId, sourceWikiId, pageConnector;

			repoApi = new wikibase.api.RepoApi( wikibase.client.getMwApiForRepo() );
			targetWikiId = mw.config.get( 'wbCurrentSite' ).globalSiteId;
			sourceWikiId = result.query.general.wikiid;

			pageConnector = new wikibase.PageConnector(
				repoApi,
				targetWikiId,
				targetTitle,
				sourceWikiId,
				sourceTitle
			);

			pageConnector.linkPages().done( function () {
				var api = new mw.Api();

				// Purge the newly-created page after adding the link,
				// so that they will appear as soon as possible without manual purging
				api.post( {
					action: 'purge',
					titles: targetTitle
				} );
			} );
		} );
	};

	$( function () {
		mw.loader.using( [
			'wikibase.api.RepoApi',
			'wikibase.client.currentSite',
			'wikibase.client.getMwApiForRepo',
			'wikibase.client.PageConnector'
		] ).then( function () {
			mw.hook( 'mw.cx.translation.published' ).add( addWikibaseLink );
		} );
	} );
}( jQuery, mediaWiki ) );
