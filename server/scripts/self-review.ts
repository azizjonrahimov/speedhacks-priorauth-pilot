// Daily self-review job: rebuild lessons from the ledger and write the "What I learned" summary.
//   npx tsx scripts/self-review.ts            (uses DB_PATH from server/.env)
// Schedule daily, e.g. Windows Task Scheduler:  schtasks /create /sc daily /st 07:00 /tn priorauth-self-review /tr "cmd /c cd /d <repo>\server && npx tsx scripts/self-review.ts"
// or cron:  0 7 * * *  cd <repo>/server && npx tsx scripts/self-review.ts
// Safe to run while the server is up (SQLite WAL); GET /lessons/summary will serve the new text.
import "dotenv/config";
import { config } from "../src/config.js";
import { Ledger } from "../src/db/ledger.js";
import { LessonsStore } from "../src/learning/lessons.js";
import { learningFrom, localLearningCounts } from "../src/learning/metric.js";
import { LessonsSummarizer } from "../src/learning/summary.js";

const ledger = new Ledger(config.dbPath);
const lessons = new LessonsStore(ledger);
lessons.rebuild();
const learning = learningFrom(localLearningCounts(ledger.allCases()), lessons.count(), "local");
const summary = await new LessonsSummarizer(ledger.db, lessons).generate(learning, { warn: (o, m) => console.warn(m, JSON.stringify(o)) });
console.log(`lessons: ${lessons.count()} | generator: ${summary.generator} | ${summary.generated_at}\n`);
console.log(summary.text);
ledger.close();
