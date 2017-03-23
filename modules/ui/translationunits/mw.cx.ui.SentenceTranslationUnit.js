'use strict';

/**
 * Sentence translation unit
 *
 * @class
 * @param {mw.cx.dm.TranslationUnit} model
 * @param {mw.cx.ui.TranslationView} view
 * @param {mw.cx.tools.TranslationToolFactory} toolFactory
 * @param {Object} config
 */
mw.cx.ui.SentenceTranslationUnit = function SentenceTranslationUnit( model, view, toolFactory, config ) {
	mw.cx.ui.SentenceTranslationUnit.parent.call( this, model, view, toolFactory, config );
};

/* Setup */
OO.inheritClass( mw.cx.ui.SentenceTranslationUnit, mw.cx.ui.TranslationUnit );

mw.cx.ui.SentenceTranslationUnit.static.name = 'sentence';
mw.cx.ui.SentenceTranslationUnit.static.matchTagNames = [ 'span' ];
mw.cx.ui.SentenceTranslationUnit.static.highlightClass = 'cx-highlight';
mw.cx.ui.SentenceTranslationUnit.static.tools = {};

/**
 * @inheritDoc
 */
mw.cx.ui.SentenceTranslationUnit.static.matchFunction = function ( node ) {
	return node.className === 'cx-segment';
};

mw.cx.ui.SentenceTranslationUnit.prototype.init = function () {
	var segmentId;

	this.$sourceSection = $( this.model.sourceDocument );
	segmentId = this.$sourceSection.data( 'segmentid' );
	this.$translationSection = this.parentTranslationUnit.$translationSection
		.find( '[data-segmentid="' + segmentId + '"]' );
	this.listen();
};

/**
 * @inheritDoc
 */
mw.cx.ui.SentenceTranslationUnit.prototype.onParentTranslationStarted = function () {
	this.init();
};

mw.cx.ui.translationUnitFactory.register( mw.cx.ui.SentenceTranslationUnit );
