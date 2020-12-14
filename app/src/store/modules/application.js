import Vue from "vue";

const state = {
  /** @type SectionSuggestion */
  currentSectionSuggestion: null,
  /** @type PageSection */
  currentSourceSection: null,
  /** @type Boolean */
  isSectionTitleSelectedForTranslation: false,
  /** @type String */
  currentMTProvider: ""
};

const mutations = {
  setCurrentSectionSuggestion(state, suggestion) {
    state.currentSectionSuggestion = suggestion;
  },

  /**
   * @param state
   * @param {PageSection} section
   */
  setCurrentSourceSection(state, section) {
    state.currentSourceSection = section;
  },

  /**
   * @param state
   * @param {String} translation
   */
  setCurrentSourceSectionTitleTranslation(state, translation) {
    state.currentSourceSection.translatedTitle = translation;
  },

  /**
   * @param state
   * @param {String} translation
   */
  setCurrentSourceSectionEditedTranslation(state, translation) {
    state.currentSourceSection.editedTranslation = translation;
  },

  /**
   * @param state
   */
  clearSentenceSelection(state) {
    const sentence = state.currentSourceSection.sentences.find(
      sentence => sentence.selected
    );

    if (sentence) {
      sentence.selected = false;
    }
  },

  /**
   * @param state
   * @param {String} id
   */
  selectSentence(state, id) {
    const sentence = state.currentSourceSection.sentences.find(
      sentence => sentence.id === id
    );
    sentence.selected = true;
  },

  /**
   * @param state
   * @param {String} translation
   */
  setSelectedSentenceTranslation(state, translation) {
    /** @type {SectionSentence} */
    const selectedSentence = state.currentSourceSection.sentences.find(
      sentence => sentence.selected
    );
    selectedSentence.translatedContent = translation;
  },

  /**
   * @param state
   * @param value
   */
  setIsSectionTitleSelectedForTranslation: (state, value) => {
    state.isSectionTitleSelectedForTranslation = value;
  },

  /**
   * @param state
   * @param provider
   */
  setCurrentMTProvider: (state, provider) => {
    state.currentMTProvider = provider;
  }
};

const getters = {
  getCurrentPage: (state, getters, rootState, rootGetters) =>
    rootGetters["mediawiki/getPage"](
      state.currentSectionSuggestion.sourceLanguage,
      state.currentSectionSuggestion.sourceTitle
    ),

  getCurrentSourceSectionTitle: state =>
    state.currentSourceSection?.title || "",

  getCurrentSourceSectionAnchor: (state, getters) =>
    (getters.getCurrentSourceSectionTitle || "").replace(/ /g, "_"),

  getCurrentSourceSectionSentences: state =>
    state.currentSourceSection?.sentences || [],

  isCurrentSentenceLast: (state, getters) =>
    getters.getCurrentSelectedSentenceIndex ===
    getters.getCurrentSourceSectionSentences.length - 1,

  isCurrentSentenceFirst: (state, getters) =>
    getters.getCurrentSelectedSentenceIndex === 0,

  isCurrentSourceSectionMissing: (state, getters) =>
    state.currentSectionSuggestion?.missingSections.hasOwnProperty(
      getters.getCurrentSourceSectionTitle
    ),

  isCurrentSourceSectionPresent: (state, getters) =>
    state.currentSectionSuggestion?.presentSections.hasOwnProperty(
      getters.getCurrentSourceSectionTitle
    ),

  getCurrentSelectedSentence: (state, getters) =>
    getters.getCurrentSourceSectionSentences.find(
      sentence => sentence.selected
    ),

  getCurrentSelectedSentenceIndex: (state, getters) =>
    getters.getCurrentSourceSectionSentences.findIndex(
      sentence => sentence.selected
    ),
  /**
   * Machine translation of section title for currently selected MT provider
   */
  getCurrentProposedTitleTranslation: state =>
    state.currentSourceSection?.proposedTitleTranslations[
      state.currentMTProvider
    ] || "",
  /**
   * Machine translation of currently selected sentence for currently selected MT provider
   */
  getCurrentProposedSentenceTranslation: (state, getters) =>
    getters.getCurrentSelectedSentence?.proposedTranslations[
      state.currentMTProvider
    ] || "",
  getCurrentProposedTranslation: (state, getters) =>
    state.isSectionTitleSelectedForTranslation
      ? getters.getCurrentProposedTitleTranslation
      : getters.getCurrentProposedSentenceTranslation,

  /**
   * @return {boolean}
   */
  translationInProgressExists: state =>
    !!state.currentSourceSection?.translatedTitle ||
    !!state.currentSourceSection?.isTranslated
};

const actions = {
  fetchCurrentSectionSuggestionLanguageTitles({ dispatch, state }) {
    const { sourceLanguage, sourceTitle } = state.currentSectionSuggestion;
    const payload = { language: sourceLanguage, title: sourceTitle };
    dispatch("mediawiki/fetchLanguageTitles", payload, { root: true });
  },
  setTranslationURLParams({ state }) {
    if (!history.pushState) {
      return;
    }
    let url = new URL(location.href);
    const params = new URLSearchParams(location.search);
    params.set("page", state.currentSectionSuggestion?.sourceTitle);
    params.set("from", state.currentSectionSuggestion?.sourceLanguage);
    params.set("to", state.currentSectionSuggestion?.targetLanguage);
    params.set("sx", true);
    url.search = params;
    url = url.toString();
    history.replaceState({ url }, null, url);
  },
  setCurrentSectionSuggestion({ commit }, suggestion) {
    commit("setCurrentSectionSuggestion", suggestion);
  },
  async selectPageSection(
    { state, commit, dispatch, rootGetters, getters },
    { sectionTitle }
  ) {
    const suggestion = state.currentSectionSuggestion;
    const page = getters.getCurrentPage;
    let section = rootGetters["mediawiki/getPageSection"](page, sectionTitle);

    if (!section) {
      await dispatch("mediawiki/fetchPageSections", suggestion, { root: true });

      section = rootGetters["mediawiki/getPageSection"](page, sectionTitle);
    }
    commit("setCurrentSourceSection", section);
  },

  /**
   * @param commit
   * @param dispatch
   * @param state
   * @param id
   */
  selectSentenceForCurrentSection({ commit, dispatch, state }, { id }) {
    commit("clearSentenceSelection");
    commit("setIsSectionTitleSelectedForTranslation", false);
    if (id) {
      commit("selectSentence", id);
      dispatch("translateSelectedSegment", {
        provider: state.currentMTProvider
      });
    }
  },

  applyTranslationToSelectedSegment(
    { state, commit, dispatch },
    { translation }
  ) {
    const mutation = state.isSectionTitleSelectedForTranslation
      ? "setCurrentSourceSectionTitleTranslation"
      : "setSelectedSentenceTranslation";
    commit(mutation, translation);
    dispatch("selectNextSentence");
  },

  applyProposedTranslationToSelectedSegment({ dispatch, getters }) {
    const translation = getters.getCurrentProposedTranslation;
    dispatch("applyTranslationToSelectedSegment", { translation });
  },

  applyEditedTranslationToSelectedSegment(
    { state, dispatch },
    { translation }
  ) {
    if (state.isSectionTitleSelectedForTranslation) {
      const div = document.createElement("div");
      div.innerHTML = translation;
      translation = div.innerText;
    }

    dispatch("applyTranslationToSelectedSegment", { translation });
  },

  /**
   * If no sentence is selected, findIndex will return -1
   * and first sentence in array will be selected
   * @param getters
   * @param dispatch
   * @param commit
   */
  selectNextSentence({ getters, dispatch, commit }) {
    commit("setIsSectionTitleSelectedForTranslation", false);
    const sentences = getters.getCurrentSourceSectionSentences;
    const nextIndex = getters.getCurrentSelectedSentenceIndex + 1;
    dispatch("selectSentenceForCurrentSection", sentences[nextIndex]);
  },

  selectPreviousSegment({ getters, dispatch, commit }) {
    if (getters.isCurrentSentenceFirst) {
      commit("setIsSectionTitleSelectedForTranslation", true);
      return;
    }
    const sentences = getters.getCurrentSourceSectionSentences;
    let selectedIndex = getters.getCurrentSelectedSentenceIndex;
    selectedIndex = (selectedIndex + sentences.length - 1) % sentences.length;
    dispatch("selectSentenceForCurrentSection", sentences[selectedIndex]);
  },

  /**
   * Checks if current MT provider exists and is valid for the
   * given language pair. If not, selects the first provider
   * among the supported ones and sets it as the current MT
   * provider.
   * @return {Promise<void>}
   */
  async initializeMTProviders({ state, dispatch, rootGetters, commit }) {
    const { sourceLanguage, targetLanguage } = state.currentSectionSuggestion;
    await dispatch(
      "mediawiki/fetchMTProviders",
      { sourceLanguage, targetLanguage },
      { root: true }
    );
    const supportedProviders = rootGetters["mediawiki/getSupportedMTProviders"](
      sourceLanguage,
      targetLanguage
    );

    const currentProvider = state.currentMTProvider;
    if (currentProvider && supportedProviders.includes(currentProvider)) {
      return;
    }

    commit("setCurrentMTProvider", supportedProviders[0]);
  },

  /**
   * @param commit
   * @param dispatch
   * @param provider
   */
  updateMTProvider({ commit, dispatch }, { provider }) {
    commit("setCurrentMTProvider", provider);
    dispatch("translateSelectedSegment", provider);
  },

  /**
   * Dispatched when SXSentenceSelector SFC is mounted
   * to set section title as selected translation segment
   * when no sentence is already selected.
   * @param getters
   * @param commit
   * @param state
   * @param dispatch
   */
  selectInitialTranslationSegment({ getters, commit, state, dispatch }) {
    /**
     * When component is mounted and no sentence is selected, translation
     * should start with section title.
     */
    if (!getters.getCurrentSelectedSentence) {
      commit("setIsSectionTitleSelectedForTranslation", true);
      dispatch("translateSelectedSegment", {
        provider: state.currentMTProvider
      });
    }
  },

  /**
   * Dispatched when section title is being clicked
   * inside "Pick a sentence" step
   * @param commit
   */
  selectSectionTitleForTranslation({ commit }) {
    commit("clearSentenceSelection");
    commit("setIsSectionTitleSelectedForTranslation", true);
  },

  /**
   * @param getters
   * @param commit
   * @param state
   * @param dispatch
   * @param provider
   */
  translateSelectedSegment({ getters, commit, state, dispatch }, { provider }) {
    dispatch("translateFollowingSentence", { provider });
    if (state.isSectionTitleSelectedForTranslation) {
      dispatch("translateSectionTitle", { provider });
      return;
    }

    dispatch("translateSelectedSentence", { provider });
  },

  /**
   * @param state
   * @param getters
   * @param dispatch
   * @param provider
   * @return {Promise<void>}
   */
  async translateSectionTitle({ state, getters, dispatch }, { provider }) {
    if (state.currentSourceSection.translatedTitle) {
      return;
    }
    const { sourceLanguage, targetLanguage } = state.currentSectionSuggestion;
    const originalContent = state.currentSourceSection.originalTitle;
    const translation = await dispatch(
      "mediawiki/translateSegment",
      { sourceLanguage, targetLanguage, provider, originalContent },
      { root: true }
    );

    Vue.set(
      state.currentSourceSection.proposedTitleTranslations,
      provider,
      translation
    );
  },

  /**
   * @param getters
   * @param dispatch
   * @param {String} provider
   * @return {Promise<void>}
   */
  async translateSelectedSentence({ getters, dispatch }, { provider }) {
    const selectedSentence = getters.getCurrentSelectedSentence;

    if (!selectedSentence || selectedSentence.proposedTranslations[provider]) {
      return;
    }

    const { sourceLanguage, targetLanguage } = state.currentSectionSuggestion;
    const { originalContent } = selectedSentence;

    const translation = await dispatch(
      "mediawiki/translateSegment",
      { sourceLanguage, targetLanguage, provider, originalContent },
      { root: true }
    );

    Vue.set(selectedSentence.proposedTranslations, provider, translation);
  },

  /**
   * @param getters
   * @param dispatch
   * @param provider
   * @return {Promise<void>}
   */
  async translateFollowingSentence({ getters, dispatch }, { provider }) {
    const nextIndex = getters.getCurrentSelectedSentenceIndex + 1;
    const sentences = getters.getCurrentSourceSectionSentences;
    if (nextIndex >= sentences.length) {
      return;
    }

    const nextSentence = sentences[nextIndex];
    const { sourceLanguage, targetLanguage } = state.currentSectionSuggestion;
    const { originalContent } = nextSentence;

    const translation = await dispatch(
      "mediawiki/translateSegment",
      { sourceLanguage, targetLanguage, provider, originalContent },
      { root: true }
    );
    Vue.set(nextSentence.proposedTranslations, provider, translation);
  },

  /**
   * Dispatched when translation for all available MT providers
   * is needed (e.g. when user wants to select among available
   * MT translations)
   * @param rootGetters
   * @param dispatch
   */
  translateSegmentForAllProviders({ rootGetters, dispatch }) {
    const { sourceLanguage, targetLanguage } = state.currentSectionSuggestion;
    const mtProviders = rootGetters["mediawiki/getSupportedMTProviders"](
      sourceLanguage,
      targetLanguage
    );
    mtProviders.forEach(provider =>
      dispatch("translateSelectedSegment", { provider })
    );
  }
};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
};
