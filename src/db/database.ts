import fs from "node:fs";
import path from "node:path";

import bcrypt from "bcryptjs";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

type SqlParams = Record<string, string | number | null>;

interface CountRow {
  count: number;
}

interface IdRow {
  id: number;
}

interface UserLookupRow {
  id: number;
}

export class DatabaseManager {
  private sqlJs?: SqlJsStatic;
  private db?: Database;
  private isInitialized = false;

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.sqlJs = await initSqlJs({
      locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
    });

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new this.sqlJs.Database(buffer);
    } else {
      this.db = new this.sqlJs.Database();
    }

    this.db.run("PRAGMA foreign_keys = ON;");
    this.createSchema();
    this.seedIfNeeded();
    this.persist();
    this.isInitialized = true;
  }

  all<T>(sql: string, params: SqlParams = {}): T[] {
    this.ensureDb();
    const statement = this.db!.prepare(sql);
    statement.bind(params);

    const rows: T[] = [];

    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }

    statement.free();
    return rows;
  }

  get<T>(sql: string, params: SqlParams = {}): T | null {
    return this.all<T>(sql, params)[0] ?? null;
  }

  run(sql: string, params: SqlParams = {}): number {
    this.ensureDb();
    this.db!.run(sql, params);
    const result = this.get<IdRow>("SELECT last_insert_rowid() AS id;");
    this.persist();
    return Number(result?.id ?? 0);
  }

  exec(sql: string): void {
    this.ensureDb();
    this.db!.run(sql);
    this.persist();
  }

  private ensureDb(): void {
    if (!this.db) {
      throw new Error("Database is not initialized.");
    }
  }

  private persist(): void {
    this.ensureDb();
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const data = this.db!.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  private createSchema(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'parent', 'admin')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS parent_student_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        UNIQUE(parent_id, student_id),
        FOREIGN KEY (parent_id) REFERENCES users(id),
        FOREIGN KEY (student_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        target_group TEXT NOT NULL,
        event_date TEXT NOT NULL,
        departure_time TEXT NOT NULL,
        location TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        seats_total INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
        organizer_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organizer_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        parent_approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (parent_approval_status IN ('pending', 'approved', 'rejected')),
        payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid', 'unpaid')),
        seat_number TEXT,
        status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, student_id),
        FOREIGN KEY (event_id) REFERENCES events(id),
        FOREIGN KEY (student_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
      );
    `);
  }

  private seedIfNeeded(): void {
    const count = this.get<CountRow>("SELECT COUNT(*) AS count FROM users;");

    if (Number(count?.count ?? 0) > 0) {
      return;
    }

    const adminId = this.run(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($name, $email, $passwordHash, 'admin');
      `,
      {
        $name: "Главен администратор",
        $email: "admin@trippilot.local",
        $passwordHash: bcrypt.hashSync("Admin123!", 10),
      },
    );

    const teacherId = this.run(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($name, $email, $passwordHash, 'teacher');
      `,
      {
        $name: "Мария Петрова",
        $email: "teacher@trippilot.local",
        $passwordHash: bcrypt.hashSync("Teacher123!", 10),
      },
    );

    const studentId = this.run(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($name, $email, $passwordHash, 'student');
      `,
      {
        $name: "Иван Георгиев",
        $email: "student@trippilot.local",
        $passwordHash: bcrypt.hashSync("Student123!", 10),
      },
    );

    const parentId = this.run(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($name, $email, $passwordHash, 'parent');
      `,
      {
        $name: "Елена Георгиева",
        $email: "parent@trippilot.local",
        $passwordHash: bcrypt.hashSync("Parent123!", 10),
      },
    );

    this.run(
      `
        INSERT INTO parent_student_links (parent_id, student_id)
        VALUES ($parentId, $studentId);
      `,
      {
        $parentId: parentId,
        $studentId: studentId,
      },
    );

    this.run(
      `
        INSERT INTO events (
          title,
          description,
          category,
          target_group,
          event_date,
          departure_time,
          location,
          price,
          seats_total,
          organizer_id
        )
        VALUES (
          $title,
          $description,
          $category,
          $targetGroup,
          $eventDate,
          $departureTime,
          $location,
          $price,
          $seatsTotal,
          $organizerId
        );
      `,
      {
        $title: "Пролетна ученическа екскурзия до Пловдив",
        $description:
          "Еднодневна ученическа екскурзия с посещение на Стария град, Античния театър и учебна беседа по история.",
        $category: "Екскурзия",
        $targetGroup: "7А клас",
        $eventDate: "2026-04-20",
        $departureTime: "07:30",
        $location: "Пловдив",
        $price: 35,
        $seatsTotal: 28,
        $organizerId: teacherId,
      },
    );

    this.run(
      `
        INSERT INTO events (
          title,
          description,
          category,
          target_group,
          event_date,
          departure_time,
          location,
          price,
          seats_total,
          organizer_id
        )
        VALUES (
          $title,
          $description,
          $category,
          $targetGroup,
          $eventDate,
          $departureTime,
          $location,
          $price,
          $seatsTotal,
          $organizerId
        );
      `,
      {
        $title: "Посещение на Националния исторически музей",
        $description:
          "Учебно посещение с учител по история за 6Б клас с организиран транспорт и работни листове.",
        $category: "Посещение на музей",
        $targetGroup: "6Б клас",
        $eventDate: "2026-04-25",
        $departureTime: "09:00",
        $location: "София",
        $price: 18,
        $seatsTotal: 30,
        $organizerId: teacherId,
      },
    );

    this.run(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
        VALUES ($actorId, $action, $entityType, $entityId, $details);
      `,
      {
        $actorId: adminId,
        $action: "seed_database",
        $entityType: "system",
        $entityId: "initial",
        $details: JSON.stringify({
          message: "Начално seed-ване на Trippilot с учител, ученик, родител и примерни ученически събития.",
        }),
      },
    );
  }

  linkParentToStudent(parentUserId: number, studentEmail: string): boolean {
    const student = this.get<UserLookupRow>(
      `
        SELECT id
        FROM users
        WHERE email = $email AND role = 'student';
      `,
      {
        $email: studentEmail.trim().toLowerCase(),
      },
    );

    if (!student) {
      return false;
    }

    this.run(
      `
        INSERT OR IGNORE INTO parent_student_links (parent_id, student_id)
        VALUES ($parentId, $studentId);
      `,
      {
        $parentId: parentUserId,
        $studentId: Number(student.id),
      },
    );

    return true;
  }

  logAction(actorUserId: number | null, action: string, entityType: string, entityId: string | null, details: unknown): void {
    this.run(
      `
        INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
        VALUES ($actorUserId, $action, $entityType, $entityId, $details);
      `,
      {
        $actorUserId: actorUserId,
        $action: action,
        $entityType: entityType,
        $entityId: entityId,
        $details: details ? JSON.stringify(details) : null,
      },
    );
  }
}
