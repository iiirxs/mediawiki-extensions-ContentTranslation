<template>
  <div v-if="suggestion" class="row cx-suggestion pa-4 ma-0">
    <div class="col shrink pe-4">
      <mw-thumbnail
        class="cx-suggestion__thumbnail"
        :thumbnail="page && page.thumbnail"
        :width="84"
      />
    </div>
    <div class="col pe-2">
      <mw-row direction="column" align="start" class="ma-0 no-wrap fill-height">
        <mw-col shrink class="mb-2">
          <h5
            class="my-0 cx-suggestion__source-title"
            :lang="suggestion.sourceLanguage"
          >
            {{ suggestion.sourceTitle }}
          </h5>
        </mw-col>
        <mw-col shrink>
          <p
            class="ma-0 cx-suggestion__source-description complementary"
            :lang="suggestion.sourceLanguage"
          >
            {{ page && page.description }}
          </p>
        </mw-col>
        <mw-col
          v-if="isSectionSuggestion"
          class="cx-suggestion__missing-sections"
          shrink
        >
          <small
            v-i18n:cx-sx-translation-suggestion-info="[missingSectionsCount]"
          />
        </mw-col>
      </mw-row>
    </div>
    <div class="col-1">
      <mw-icon
        :icon="mwIconClose"
        size="24"
        class="mb-4"
        @click.stop="$emit('close')"
      />
      <mw-icon
        v-if="!$incompleteVersion"
        :icon="mwIconBookmarkOutline"
        size="24"
        @click.stop="$emit('bookmark')"
      />
    </div>
  </div>
</template>

<script>
import { MwIcon, MwThumbnail, MwRow, MwCol } from "@/lib/mediawiki.ui";
import {
  mwIconClose,
  mwIconBookmarkOutline,
  mwIconArrowForward
} from "@/lib/mediawiki.ui/components/icons";
import ArticleSuggestion from "@/wiki/cx/models/articleSuggestion";
import SectionSuggestion from "@/wiki/cx/models/sectionSuggestion";

export default {
  name: "CxTranslationSuggestion",
  components: { MwThumbnail, MwIcon, MwRow, MwCol },
  props: {
    suggestion: {
      type: [ArticleSuggestion, SectionSuggestion],
      required: true
    }
  },
  data: () => ({ mwIconClose, mwIconBookmarkOutline, mwIconArrowForward }),
  computed: {
    page: function() {
      return this.$store.getters["mediawiki/getPage"](
        this.suggestion.sourceLanguage,
        this.suggestion.sourceTitle
      );
    },
    isSectionSuggestion: vm => vm.suggestion instanceof SectionSuggestion,
    missingSectionsCount: vm => vm.suggestion?.missingSectionsCount
  }
};
</script>

<style lang="less">
@import "@/lib/mediawiki.ui/variables/wikimedia-ui-base.less";

.cx-suggestion {
  // Not sure if @background-color-notice-frame variable is ok to use here
  border-top: @border-width-base @border-style-base
    @background-color-notice--framed;
  cursor: pointer;
  min-height: 100px;
  line-height: normal;
  transition: background-color 100ms, border-color 100ms, transform 1s,
    opacity 1s;
  &:hover {
    background-color: @background-color-primary;
  }
  &__thumbnail.mw-ui-thumbnail {
    height: 84px;
    width: 84px;
  }
  &__source-description {
    color: @wmui-color-base20;
  }
  &__missing-sections {
    margin-top: auto;
    color: @color-base--subtle;
  }
}
</style>
