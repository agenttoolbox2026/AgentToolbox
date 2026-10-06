-- UTC daily counters survive expiry without retaining caller identifiers or bodies.
-- No backfill: coverage starts when this migration is first applied.
CREATE TABLE usage_coverage (
  id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT NOT NULL
);
INSERT INTO usage_coverage VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE daily_usage (
  day TEXT PRIMARY KEY,
  quotes INTEGER NOT NULL DEFAULT 0,
  stopped INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  declined INTEGER NOT NULL DEFAULT 0,
  results INTEGER NOT NULL DEFAULT 0,
  eligible_self_reports INTEGER NOT NULL DEFAULT 0,
  helpful INTEGER NOT NULL DEFAULT 0,
  unhelpful INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER usage_quote AFTER INSERT ON recoveries BEGIN
  INSERT INTO daily_usage(day,quotes,stopped)
  VALUES(strftime('%Y-%m-%d',NEW.created_ms/1000,'unixepoch'),1,1-NEW.recoverable)
  ON CONFLICT(day) DO UPDATE SET quotes=quotes+1,stopped=stopped+excluded.stopped;
END;
CREATE TRIGGER usage_accept AFTER INSERT ON acceptances BEGIN
  INSERT INTO daily_usage(day,accepted,declined)
  VALUES(strftime('%Y-%m-%d',NEW.created_ms/1000,'unixepoch'),NEW.accepted,1-NEW.accepted)
  ON CONFLICT(day) DO UPDATE SET accepted=accepted+excluded.accepted,declined=declined+excluded.declined;
END;
CREATE TRIGGER usage_result AFTER INSERT ON results BEGIN
  INSERT INTO daily_usage(day,results,eligible_self_reports)
  VALUES(strftime('%Y-%m-%d',NEW.created_ms/1000,'unixepoch'),1,NEW.eligible)
  ON CONFLICT(day) DO UPDATE SET results=results+1,eligible_self_reports=eligible_self_reports+excluded.eligible_self_reports;
END;
CREATE TRIGGER usage_feedback AFTER INSERT ON feedback BEGIN
  INSERT INTO daily_usage(day,helpful,unhelpful)
  VALUES(strftime('%Y-%m-%d',NEW.created_ms/1000,'unixepoch'),NEW.helpful,1-NEW.helpful)
  ON CONFLICT(day) DO UPDATE SET helpful=helpful+excluded.helpful,unhelpful=unhelpful+excluded.unhelpful;
END;
