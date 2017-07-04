-- Example steps for creating a new database for testing this:
-- mysql> CREATE DATABASE contenttranslation;
-- mysql> USE contenttranslation;
-- In the next line replace "USER" with the value of $wgDBuser from your LocalSettings.php,
-- and replace localhost with your hostname if needed.
-- mysql> GRANT ALL ON contenttranslation.* to 'USER'@'localhost';
-- mysql> SOURCE contenttranslation.sql

DROP TABLE IF EXISTS /*_*/cx_translations;
CREATE TABLE /*_*/cx_translations (
    -- translation id. Autogenerated.
    translation_id int primary key auto_increment,
    -- Source title of the translation
    translation_source_title varbinary(512) not null,
    -- Target title of the translation
    translation_target_title varbinary(512) not null,
    -- Source language. language code
    translation_source_language varbinary(36) not null,
    -- Target language. language code
    translation_target_language varbinary(36) not null,
    -- Revision id of source article
    translation_source_revision_id INT UNSIGNED,
    -- Revision id of published translation
    translation_target_revision_id INT UNSIGNED,
    -- source of the page as full canonical url -- https://www.mediawiki.org/wiki/Help:CxIsPage
    translation_source_url text binary not null,
    -- link to the draft/published target
    translation_target_url text binary default null,
    -- Status of translation - Draft or published status.
    -- There is no final status. A published translation can be draft again to update again
    translation_status enum('draft', 'published', 'deleted') default null,
    -- Start date of this translation
    translation_start_timestamp varchar(14) binary not null,
    -- Last updated date of this translation
    translation_last_updated_timestamp varchar(14) binary not null,
    -- Progress of the translation - json dump
    translation_progress TINYBLOB not null,
    -- Who started this translation? User id
    translation_started_by int,
    -- Who did the last translation? It need not be the translator who started.
    translation_last_update_by int
) /*$wgDBTableOptions*/;

CREATE UNIQUE INDEX /*i*/cx_translation_ref ON /*_*/cx_translations (
    translation_source_title,
    translation_source_language,
    translation_target_language,
    translation_started_by
);

CREATE INDEX /*i*/cx_translation_languages ON /*_*/cx_translations (
    translation_source_language,
    translation_target_language,
    translation_status
);

DROP TABLE IF EXISTS /*_*/cx_translators;
CREATE TABLE /*_*/cx_translators (
    -- Translators id - global user id
    translator_user_id int not null,
    -- Translation id - foreign key to translations.translation_id
    translator_translation_id int not null
) /*$wgDBTableOptions*/;

CREATE UNIQUE INDEX /*i*/cx_translation_translators ON /*_*/cx_translators (
    translator_user_id,
    translator_translation_id
);
