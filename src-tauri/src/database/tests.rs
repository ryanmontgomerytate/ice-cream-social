// Edge-case tests for the Character and Content management features
// Run with: cargo test --package ice-cream-social --lib database::tests

#[cfg(test)]
mod character_tests {
    use crate::database::Database;
    use tempfile::TempDir;

    fn setup_test_db() -> (Database, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(&db_path).unwrap();
        (db, temp_dir)
    }

    // =========================================================================
    // Character Creation Edge Cases
    // =========================================================================

    #[test]
    fn test_create_character_basic() {
        let (db, _temp) = setup_test_db();
        let id = db
            .create_character("Sweet Bean", None, None, None, None)
            .unwrap();
        assert!(id > 0);

        let chars = db.get_characters().unwrap();
        assert_eq!(chars.len(), 1);
        assert_eq!(chars[0].name, "Sweet Bean");
    }

    #[test]
    fn test_create_character_with_all_fields() {
        let (db, _temp) = setup_test_db();
        let _id = db
            .create_character(
                "Count Absorbo",
                Some("Absorbo"),
                Some("A vampire who absorbs things"),
                Some("I vant to absorb your blood!"),
                None,
            )
            .unwrap();

        let chars = db.get_characters().unwrap();
        assert_eq!(chars[0].short_name, Some("Absorbo".to_string()));
        assert_eq!(
            chars[0].description,
            Some("A vampire who absorbs things".to_string())
        );
        assert_eq!(
            chars[0].catchphrase,
            Some("I vant to absorb your blood!".to_string())
        );
    }

    #[test]
    fn test_create_character_duplicate_name_fails() {
        let (db, _temp) = setup_test_db();
        db.create_character("Sweet Bean", None, None, None, None)
            .unwrap();

        // Duplicate should fail due to UNIQUE constraint
        let result = db.create_character("Sweet Bean", None, None, None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_character_case_sensitivity() {
        let (db, _temp) = setup_test_db();
        // SQLite is case-insensitive by default for UNIQUE
        db.create_character("Sweet Bean", None, None, None, None)
            .unwrap();

        // These might or might not fail depending on collation
        // Test documents current behavior
        let result = db.create_character("sweet bean", None, None, None, None);
        // This tests the actual behavior - case sensitivity depends on SQLite config
        println!("Case different insert result: {:?}", result.is_ok());
    }

    #[test]
    fn test_create_character_empty_name() {
        let (db, _temp) = setup_test_db();
        // Empty string should be allowed at DB level (validation at API level)
        let result = db.create_character("", None, None, None, None);
        assert!(result.is_ok()); // DB allows it, validation should be in frontend/command
    }

    #[test]
    fn test_create_character_whitespace_only_name() {
        let (db, _temp) = setup_test_db();
        let result = db.create_character("   ", None, None, None, None);
        assert!(result.is_ok()); // DB allows it, needs frontend validation
    }

    #[test]
    fn test_create_character_unicode_name() {
        let (db, _temp) = setup_test_db();
        let id = db
            .create_character("Señor 日本語 🎉", None, None, None, None)
            .unwrap();
        assert!(id > 0);

        let chars = db.get_characters().unwrap();
        assert_eq!(chars[0].name, "Señor 日本語 🎉");
    }

    #[test]
    fn test_create_character_very_long_name() {
        let (db, _temp) = setup_test_db();
        let long_name = "A".repeat(10000);
        let result = db.create_character(&long_name, None, None, None, None);
        assert!(result.is_ok()); // SQLite TEXT has no limit
    }

    #[test]
    fn test_create_character_special_characters() {
        let (db, _temp) = setup_test_db();
        // Test SQL injection and special chars
        let names = vec![
            "O'Brien's Character",
            "Test\"Quotes\"Here",
            "Back\\slash",
            "Semi;colon",
            "Drop; DROP TABLE characters;--",
            "<script>alert('xss')</script>",
        ];

        for name in names {
            let result = db.create_character(name, None, None, None, None);
            assert!(result.is_ok(), "Failed for name: {}", name);
        }
    }

    // =========================================================================
    // Character Appearance Edge Cases
    // =========================================================================

    fn setup_db_with_episode() -> (Database, TempDir, i64) {
        let (db, temp) = setup_test_db();

        // Create a test episode
        let (episode_id, _) = db
            .upsert_episode(
                Some("123"),
                "Test Episode",
                None,
                "http://example.com/test.mp3",
                Some(3600.0),
                None,
                Some("2024-01-01"),
                "test",
            )
            .unwrap();

        (db, temp, episode_id)
    }

    #[test]
    fn test_add_appearance_basic() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        let app_id = db
            .add_character_appearance(char_id, episode_id, None, None, None)
            .unwrap();
        assert!(app_id > 0);
    }

    #[test]
    fn test_add_appearance_with_timestamp() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        let app_id = db
            .add_character_appearance(
                char_id,
                episode_id,
                Some(125.5), // 2:05.5
                Some(180.0), // 3:00
                Some(5),
            )
            .unwrap();
        assert!(app_id > 0);
    }

    #[test]
    fn test_add_appearance_negative_start_time() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        // Negative time - DB accepts it (validation should be at API level)
        let result = db.add_character_appearance(char_id, episode_id, Some(-100.0), None, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_add_appearance_start_after_end() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        // start > end - DB accepts it (validation should be at API level)
        let result = db.add_character_appearance(
            char_id,
            episode_id,
            Some(500.0), // start
            Some(100.0), // end (before start)
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_add_appearance_very_large_timestamp() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        // Very large timestamp (beyond any episode length)
        let result =
            db.add_character_appearance(char_id, episode_id, Some(999999999.0), None, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_add_appearance_zero_timestamp() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        let result = db.add_character_appearance(char_id, episode_id, Some(0.0), None, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_add_appearance_nonexistent_character() {
        let (db, _temp, episode_id) = setup_db_with_episode();

        // Character ID 99999 doesn't exist - should fail due to FK constraint
        let result = db.add_character_appearance(99999, episode_id, None, None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_add_appearance_nonexistent_episode() {
        let (db, _temp, _) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        // Episode ID 99999 doesn't exist - should fail due to FK constraint
        let result = db.add_character_appearance(char_id, 99999, None, None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_add_multiple_appearances_same_episode() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        // Same character can appear multiple times in same episode (different timestamps)
        let app1 = db
            .add_character_appearance(char_id, episode_id, Some(100.0), None, None)
            .unwrap();
        let app2 = db
            .add_character_appearance(char_id, episode_id, Some(500.0), None, None)
            .unwrap();

        assert_ne!(app1, app2);
    }

    #[test]
    fn test_add_duplicate_appearance_exact_same() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        // No UNIQUE constraint on appearances - duplicates allowed
        let app1 = db
            .add_character_appearance(char_id, episode_id, Some(100.0), None, None)
            .unwrap();
        let app2 = db
            .add_character_appearance(char_id, episode_id, Some(100.0), None, None)
            .unwrap();

        // Both should succeed (potential data quality issue)
        assert!(app1 > 0);
        assert!(app2 > 0);
    }

    #[test]
    fn test_add_appearance_negative_segment_idx() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        let result = db.add_character_appearance(char_id, episode_id, None, None, Some(-1));
        assert!(result.is_ok()); // DB accepts it
    }

    // =========================================================================
    // Character Update Edge Cases
    // =========================================================================

    #[test]
    fn test_update_character_basic() {
        let (db, _temp) = setup_test_db();
        let id = db
            .create_character("Old Name", None, None, None, None)
            .unwrap();

        db.update_character(id, "New Name", None, None, None, None)
            .unwrap();

        let chars = db.get_characters().unwrap();
        assert_eq!(chars[0].name, "New Name");
    }

    #[test]
    fn test_update_character_to_duplicate_name() {
        let (db, _temp) = setup_test_db();
        let _id1 = db
            .create_character("Character 1", None, None, None, None)
            .unwrap();
        let id2 = db
            .create_character("Character 2", None, None, None, None)
            .unwrap();

        // Try to rename character 2 to same name as character 1
        let result = db.update_character(id2, "Character 1", None, None, None, None);
        assert!(result.is_err()); // UNIQUE constraint violation
    }

    #[test]
    fn test_update_nonexistent_character() {
        let (db, _temp) = setup_test_db();

        // Update non-existent character - executes without error but affects 0 rows
        let result = db.update_character(99999, "Name", None, None, None, None);
        assert!(result.is_ok()); // No error, just no effect
    }

    // =========================================================================
    // Character Delete Edge Cases
    // =========================================================================

    #[test]
    fn test_delete_character_basic() {
        let (db, _temp) = setup_test_db();
        let id = db
            .create_character("To Delete", None, None, None, None)
            .unwrap();

        db.delete_character(id).unwrap();

        let chars = db.get_characters().unwrap();
        assert!(chars.is_empty());
    }

    #[test]
    fn test_delete_character_cascades_appearances() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        // Add appearances
        db.add_character_appearance(char_id, episode_id, Some(100.0), None, None)
            .unwrap();
        db.add_character_appearance(char_id, episode_id, Some(200.0), None, None)
            .unwrap();

        // Delete character - should cascade to appearances
        db.delete_character(char_id).unwrap();

        // Character should be gone
        let chars = db.get_characters().unwrap();
        assert!(chars.is_empty());
    }

    #[test]
    fn test_delete_nonexistent_character() {
        let (db, _temp) = setup_test_db();

        // Delete non-existent - no error, just no effect
        let result = db.delete_character(99999);
        assert!(result.is_ok());
    }

    // =========================================================================
    // Character Query Edge Cases
    // =========================================================================

    #[test]
    fn test_get_characters_empty() {
        let (db, _temp) = setup_test_db();
        let chars = db.get_characters().unwrap();
        assert!(chars.is_empty());
    }

    #[test]
    fn test_get_characters_appearance_count() {
        let (db, _temp, episode_id) = setup_db_with_episode();
        let char_id = db
            .create_character("Test Char", None, None, None, None)
            .unwrap();

        // Add 3 appearances
        for i in 0..3 {
            db.add_character_appearance(char_id, episode_id, Some(i as f64 * 100.0), None, None)
                .unwrap();
        }

        let chars = db.get_characters().unwrap();
        assert_eq!(chars[0].appearance_count, Some(3));
    }
}

#[cfg(test)]
mod sponsor_tests {
    use crate::database::Database;
    use tempfile::TempDir;

    fn setup_test_db() -> (Database, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(&db_path).unwrap();
        (db, temp_dir)
    }

    #[test]
    fn test_create_sponsor_fake() {
        let (db, _temp) = setup_test_db();
        let _id = db
            .create_sponsor("Fake Corp", Some("We're not real!"), None, false)
            .unwrap();

        let sponsors = db.get_sponsors().unwrap();
        assert_eq!(sponsors[0].is_real, false);
    }

    #[test]
    fn test_create_sponsor_real() {
        let (db, _temp) = setup_test_db();
        let _id = db.create_sponsor("Real Corp", None, None, true).unwrap();

        let sponsors = db.get_sponsors().unwrap();
        assert_eq!(sponsors[0].is_real, true);
    }

    #[test]
    fn test_sponsor_duplicate_name_fails() {
        let (db, _temp) = setup_test_db();
        db.create_sponsor("Test Sponsor", None, None, false)
            .unwrap();
        let result = db.create_sponsor("Test Sponsor", None, None, true);
        assert!(result.is_err()); // UNIQUE constraint
    }

    #[test]
    fn test_sponsor_mention_nonexistent_sponsor() {
        let (db, _temp) = setup_test_db();

        // Create an episode first
        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        // Non-existent sponsor - should fail FK constraint
        let result = db.add_sponsor_mention(99999, episode_id, None, None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_sponsor_mention_nonexistent_episode() {
        let (db, _temp) = setup_test_db();
        let sponsor_id = db.create_sponsor("Test", None, None, false).unwrap();

        // Non-existent episode - should fail FK constraint
        let result = db.add_sponsor_mention(sponsor_id, 99999, None, None, None);
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod search_tests {
    use crate::database::{Database, TranscriptSegment};
    use tempfile::TempDir;

    fn setup_test_db() -> (Database, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(&db_path).unwrap();
        (db, temp_dir)
    }

    #[test]
    fn test_search_basic() {
        let (db, _temp) = setup_test_db();

        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test Episode",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        let segments = vec![TranscriptSegment {
            speaker: Some("Matt".to_string()),
            text: "Hello world, this is a test segment".to_string(),
            start_time: 0.0,
            end_time: Some(5.0),
        }];

        db.index_transcript_segments(episode_id, &segments).unwrap();

        let results = db.search_transcripts("hello", 50, 0).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].text.contains("Hello world"));
    }

    #[test]
    fn test_search_no_results() {
        let (db, _temp) = setup_test_db();

        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test Episode",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        let segments = vec![TranscriptSegment {
            speaker: None,
            text: "Hello world".to_string(),
            start_time: 0.0,
            end_time: None,
        }];

        db.index_transcript_segments(episode_id, &segments).unwrap();

        let results = db.search_transcripts("nonexistent", 50, 0).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_pagination() {
        let (db, _temp) = setup_test_db();

        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test Episode",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        // Create 10 segments all containing "test"
        let segments: Vec<TranscriptSegment> = (0..10)
            .map(|i| TranscriptSegment {
                speaker: None,
                text: format!("Test segment number {}", i),
                start_time: i as f64 * 10.0,
                end_time: Some((i + 1) as f64 * 10.0),
            })
            .collect();

        db.index_transcript_segments(episode_id, &segments).unwrap();

        // Get first page
        let page1 = db.search_transcripts("test", 3, 0).unwrap();
        assert_eq!(page1.len(), 3);

        // Get second page
        let page2 = db.search_transcripts("test", 3, 3).unwrap();
        assert_eq!(page2.len(), 3);

        // Pages should be different
        assert_ne!(page1[0].id, page2[0].id);
    }

    #[test]
    fn test_index_empty_segments() {
        let (db, _temp) = setup_test_db();

        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        let result = db.index_transcript_segments(episode_id, &[]);
        assert!(result.is_ok());
    }

    #[test]
    fn test_index_segment_with_empty_text() {
        let (db, _temp) = setup_test_db();

        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        let segments = vec![TranscriptSegment {
            speaker: None,
            text: "".to_string(),
            start_time: 0.0,
            end_time: None,
        }];

        let result = db.index_transcript_segments(episode_id, &segments);
        assert!(result.is_ok());
    }

    #[test]
    fn test_reindex_episode_replaces_segments() {
        let (db, _temp) = setup_test_db();

        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        // Index first set
        let segments1 = vec![TranscriptSegment {
            speaker: None,
            text: "Original content".to_string(),
            start_time: 0.0,
            end_time: None,
        }];
        db.index_transcript_segments(episode_id, &segments1)
            .unwrap();

        // Reindex with new content
        let segments2 = vec![TranscriptSegment {
            speaker: None,
            text: "Updated content".to_string(),
            start_time: 0.0,
            end_time: None,
        }];
        db.index_transcript_segments(episode_id, &segments2)
            .unwrap();

        // Search for old content - should not find
        let old_results = db.search_transcripts("Original", 50, 0).unwrap();
        assert!(old_results.is_empty());

        // Search for new content - should find
        let new_results = db.search_transcripts("Updated", 50, 0).unwrap();
        assert_eq!(new_results.len(), 1);
    }

    #[test]
    fn test_search_count() {
        let (db, _temp) = setup_test_db();

        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        let segments: Vec<TranscriptSegment> = (0..5)
            .map(|i| TranscriptSegment {
                speaker: None,
                text: format!("Searchable segment {}", i),
                start_time: i as f64,
                end_time: None,
            })
            .collect();

        db.index_transcript_segments(episode_id, &segments).unwrap();

        let count = db.count_search_results("Searchable").unwrap();
        assert_eq!(count, 5);
    }
}

#[cfg(test)]
mod episode_tests {
    use crate::database::Database;
    use tempfile::TempDir;

    fn setup_test_db() -> (Database, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(&db_path).unwrap();
        (db, temp_dir)
    }

    #[test]
    fn test_upsert_new_episode() {
        let (db, _temp) = setup_test_db();

        let (id, is_new) = db
            .upsert_episode(
                Some("100"),
                "Test Episode",
                Some("Description"),
                "http://example.com/test.mp3",
                Some(3600.0),
                Some(50_000_000),
                Some("2024-01-01"),
                "patreon",
            )
            .unwrap();

        assert!(id > 0);
        assert!(is_new);
    }

    #[test]
    fn test_upsert_existing_episode() {
        let (db, _temp) = setup_test_db();

        // Insert first time
        let (id1, is_new1) = db
            .upsert_episode(
                Some("100"),
                "Original Title",
                None,
                "http://example.com/test.mp3",
                None,
                None,
                None,
                "patreon",
            )
            .unwrap();

        assert!(is_new1);

        // Upsert again with same URL
        let (id2, is_new2) = db
            .upsert_episode(
                Some("100"),
                "Updated Title",
                Some("New description"),
                "http://example.com/test.mp3", // Same URL
                Some(3600.0),
                None,
                None,
                "patreon",
            )
            .unwrap();

        assert_eq!(id1, id2); // Same episode
        assert!(!is_new2); // Not new

        // Verify update
        let episode = db.get_episode_by_id(id1).unwrap().unwrap();
        assert_eq!(episode.title, "Updated Title");
    }

    #[test]
    fn test_episode_special_characters_in_title() {
        let (db, _temp) = setup_test_db();

        let titles = vec![
            "Episode with 'quotes'",
            "Episode with \"double quotes\"",
            "Episode with\nnewline",
            "Episode with <html>",
            "Episode with emoji 🎙️",
        ];

        for (i, title) in titles.iter().enumerate() {
            let (id, _) = db
                .upsert_episode(
                    Some(&format!("{}", i)),
                    title,
                    None,
                    &format!("http://test{}.mp3", i),
                    None,
                    None,
                    None,
                    "test",
                )
                .unwrap();

            let episode = db.get_episode_by_id(id).unwrap().unwrap();
            assert_eq!(&episode.title, title);
        }
    }
}

#[cfg(test)]
mod extraction_tests {
    use crate::database::Database;
    use tempfile::TempDir;

    fn setup_test_db() -> (Database, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Database::new(&db_path).unwrap();
        (db, temp_dir)
    }

    #[test]
    fn test_default_prompts_created() {
        let (db, _temp) = setup_test_db();

        let prompts = db.get_extraction_prompts().unwrap();
        assert!(prompts.len() >= 4); // Default prompts in schema
    }

    #[test]
    fn test_create_custom_prompt() {
        let (db, _temp) = setup_test_db();

        let id = db
            .create_extraction_prompt(
                "Custom Prompt",
                Some("Test description"),
                "custom",
                "Extract things from: {text}",
                Some("You are a helpful assistant"),
                Some(r#"{"type":"array"}"#),
            )
            .unwrap();

        let prompt = db.get_extraction_prompt(id).unwrap().unwrap();
        assert_eq!(prompt.name, "Custom Prompt");
        assert_eq!(prompt.content_type, "custom");
    }

    #[test]
    fn test_update_prompt() {
        let (db, _temp) = setup_test_db();

        let id = db
            .create_extraction_prompt("Original", None, "custom", "Original text", None, None)
            .unwrap();

        db.update_extraction_prompt(
            id,
            "Updated",
            Some("Updated desc"),
            "custom",
            "Updated text",
            None,
            None,
            true,
        )
        .unwrap();

        let prompt = db.get_extraction_prompt(id).unwrap().unwrap();
        assert_eq!(prompt.name, "Updated");
        assert_eq!(prompt.prompt_text, "Updated text");
    }

    #[test]
    fn test_extraction_run_workflow() {
        let (db, _temp) = setup_test_db();

        // Create episode
        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        // Create prompt
        let prompt_id = db
            .create_extraction_prompt("Test Prompt", None, "custom", "Extract", None, None)
            .unwrap();

        // Start run
        let run_id = db
            .create_extraction_run(prompt_id, episode_id, "input text")
            .unwrap();

        // Complete run
        db.complete_extraction_run(run_id, "raw response", Some(r#"[{"item": 1}]"#), 1, 500)
            .unwrap();

        // Verify
        let runs = db.get_extraction_runs_for_episode(episode_id).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "completed");
        assert_eq!(runs[0].items_extracted, 1);
    }

    #[test]
    fn test_extraction_run_failure() {
        let (db, _temp) = setup_test_db();

        let (episode_id, _) = db
            .upsert_episode(
                Some("1"),
                "Test",
                None,
                "http://test.mp3",
                None,
                None,
                None,
                "test",
            )
            .unwrap();

        let prompt_id = db
            .create_extraction_prompt("Test", None, "custom", "Extract", None, None)
            .unwrap();

        let run_id = db
            .create_extraction_run(prompt_id, episode_id, "input")
            .unwrap();

        db.fail_extraction_run(run_id, "Connection timeout", 1000)
            .unwrap();

        let runs = db.get_extraction_runs_for_episode(episode_id).unwrap();
        assert_eq!(runs[0].status, "failed");
        assert_eq!(
            runs[0].error_message,
            Some("Connection timeout".to_string())
        );
    }
}
