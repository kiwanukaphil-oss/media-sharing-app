ALTER TABLE `publications` ADD `source_scope_id` text REFERENCES asset_scopes(id);--> statement-breakpoint
ALTER TABLE `publications` ADD `destination_scope_id` text REFERENCES asset_scopes(id);
--> statement-breakpoint
CREATE TRIGGER publication_scope_consistency BEFORE INSERT ON publications BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM media source WHERE source.id=NEW.source_id AND source.space_id=NEW.source_space_id AND source.access_scope_id IS NEW.source_scope_id)
    OR NOT EXISTS(SELECT 1 FROM media destination WHERE destination.id=NEW.id AND destination.space_id=NEW.destination_space_id AND destination.access_scope_id IS NEW.destination_scope_id)
    OR (NEW.source_space_id=NEW.destination_space_id AND NEW.source_scope_id IS NEW.destination_scope_id)
    THEN RAISE(ABORT,'Incompatible copy audience') END;
END;
--> statement-breakpoint
CREATE TRIGGER publication_audience_immutable BEFORE UPDATE OF source_id,source_space_id,destination_space_id,source_scope_id,destination_scope_id,person_id ON publications
WHEN NEW.source_id IS NOT OLD.source_id OR NEW.source_space_id IS NOT OLD.source_space_id OR NEW.destination_space_id IS NOT OLD.destination_space_id
  OR NEW.source_scope_id IS NOT OLD.source_scope_id OR NEW.destination_scope_id IS NOT OLD.destination_scope_id OR NEW.person_id IS NOT OLD.person_id
BEGIN SELECT RAISE(ABORT,'Copy audience is immutable'); END;
