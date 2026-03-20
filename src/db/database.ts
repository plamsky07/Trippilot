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

interface SeedStats {
  users: number;
  events: number;
  links: number;
  registrations: number;
}

interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: "student" | "teacher" | "parent" | "admin";
}

interface SeedEvent {
  title: string;
  description: string;
  category: string;
  targetGroup: string;
  eventDate: string;
  departureTime: string;
  location: string;
  price: number;
  seatsTotal: number;
  organizerEmail: string;
  status?: "open" | "cancelled";
}

interface SeedRegistration {
  eventTitle: string;
  studentEmail: string;
  parentApprovalStatus: "pending" | "approved" | "rejected";
  paymentStatus: "paid" | "unpaid";
  seatNumber: string | null;
  status: "registered" | "cancelled";
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
    const stats: SeedStats = {
      users: 0,
      events: 0,
      links: 0,
      registrations: 0,
    };

    const demoUsers: SeedUser[] = [
      { name: "Главен администратор", email: "admin@trippilot.local", password: "Admin123!", role: "admin" },
      { name: "Мария Петрова", email: "teacher@trippilot.local", password: "Teacher123!", role: "teacher" },
      { name: "Илия Димитров", email: "teacher.history@trippilot.local", password: "Teacher123!", role: "teacher" },
      { name: "Надежда Стоянова", email: "teacher.sports@trippilot.local", password: "Teacher123!", role: "teacher" },
      { name: "Иван Георгиев", email: "student@trippilot.local", password: "Student123!", role: "student" },
      { name: "Мария Николова", email: "student.maria@trippilot.local", password: "Student123!", role: "student" },
      { name: "Петър Иванов", email: "student.petar@trippilot.local", password: "Student123!", role: "student" },
      { name: "Елица Тодорова", email: "student.eli@trippilot.local", password: "Student123!", role: "student" },
      { name: "Виктор Симеонов", email: "student.viktor@trippilot.local", password: "Student123!", role: "student" },
      { name: "Габриела Маринова", email: "student.gabi@trippilot.local", password: "Student123!", role: "student" },
      { name: "Елена Георгиева", email: "parent@trippilot.local", password: "Parent123!", role: "parent" },
      { name: "Десислава Николова", email: "parent.maria@trippilot.local", password: "Parent123!", role: "parent" },
      { name: "Светослав Иванов", email: "parent.petar@trippilot.local", password: "Parent123!", role: "parent" },
      { name: "Ралица Тодорова", email: "parent.eli@trippilot.local", password: "Parent123!", role: "parent" },
    ];

    const userIds = new Map<string, number>();

    for (const user of demoUsers) {
      userIds.set(user.email, this.ensureUser(user, stats));
    }

    this.ensureParentStudentLink("parent@trippilot.local", "student@trippilot.local", userIds, stats);
    this.ensureParentStudentLink("parent.maria@trippilot.local", "student.maria@trippilot.local", userIds, stats);
    this.ensureParentStudentLink("parent.petar@trippilot.local", "student.petar@trippilot.local", userIds, stats);
    this.ensureParentStudentLink("parent.eli@trippilot.local", "student.eli@trippilot.local", userIds, stats);

    const demoEvents: SeedEvent[] = [
      {
        title: "Пролетна ученическа екскурзия до Пловдив",
        description: "Еднодневна ученическа екскурзия с посещение на Стария град, Античния театър и учебна беседа по история.",
        category: "Екскурзия",
        targetGroup: "7А клас",
        eventDate: "2026-04-20",
        departureTime: "07:30",
        location: "Пловдив",
        price: 35,
        seatsTotal: 28,
        organizerEmail: "teacher@trippilot.local",
      },
      {
        title: "Посещение на Националния исторически музей",
        description: "Учебно посещение с учител по история за 6Б клас с организиран транспорт и работни листове.",
        category: "Посещение на музей",
        targetGroup: "6Б клас",
        eventDate: "2026-04-25",
        departureTime: "09:00",
        location: "София",
        price: 18,
        seatsTotal: 30,
        organizerEmail: "teacher@trippilot.local",
      },
      {
        title: "Зелено училище в Банско",
        description: "Тридневно зелено училище с природни уроци, поход в планината, вечерна програма и организиран транспорт.",
        category: "Зелено училище",
        targetGroup: "5А и 5Б клас",
        eventDate: "2026-05-11",
        departureTime: "06:30",
        location: "Банско",
        price: 220,
        seatsTotal: 44,
        organizerEmail: "teacher@trippilot.local",
      },
      {
        title: "Природонаучен музей и зоопарк Варна",
        description: "Комбинирано учебно посещение за 3А клас с фокус върху животинския свят, биологията и наблюдение на експонати.",
        category: "Посещение на музей",
        targetGroup: "3А клас",
        eventDate: "2026-05-18",
        departureTime: "07:00",
        location: "Варна",
        price: 42,
        seatsTotal: 26,
        organizerEmail: "teacher.history@trippilot.local",
      },
      {
        title: "Спортен ден на открито в Южния парк",
        description: "Състезателни щафети, игри по отбори и активности на открито за ученици от прогимназиален етап.",
        category: "Спортен ден",
        targetGroup: "8А, 8Б и 8В клас",
        eventDate: "2026-04-28",
        departureTime: "08:30",
        location: "София",
        price: 12,
        seatsTotal: 90,
        organizerEmail: "teacher.sports@trippilot.local",
      },
      {
        title: "Училищно тържество за 24 май",
        description: "Празнична програма с рецитал, музикални изпълнения и награждаване на отличени ученици.",
        category: "Училищно тържество",
        targetGroup: "Цялото училище",
        eventDate: "2026-05-23",
        departureTime: "10:00",
        location: "Актова зала",
        price: 0,
        seatsTotal: 180,
        organizerEmail: "teacher@trippilot.local",
      },
      {
        title: "Екскурзия до Велико Търново и Арбанаси",
        description: "Историческа обиколка с екскурзовод, посещение на Царевец и образователни задачи за учениците.",
        category: "Екскурзия",
        targetGroup: "6А клас",
        eventDate: "2026-05-09",
        departureTime: "07:00",
        location: "Велико Търново",
        price: 48,
        seatsTotal: 32,
        organizerEmail: "teacher.history@trippilot.local",
      },
      {
        title: "Посещение на Техническия музей и планетариум",
        description: "Учебно излизане с демонстрации по физика, астрономия и интерактивни експозиции за 4Б клас.",
        category: "Посещение на музей",
        targetGroup: "4Б клас",
        eventDate: "2026-06-02",
        departureTime: "08:45",
        location: "София",
        price: 24,
        seatsTotal: 28,
        organizerEmail: "teacher.history@trippilot.local",
      },
      {
        title: "Зелено училище край Смолян",
        description: "Четиридневна програма със занимания в природата, ориентиране, екипни задачи и вечерни работилници.",
        category: "Зелено училище",
        targetGroup: "7Б и 7В клас",
        eventDate: "2026-06-15",
        departureTime: "06:15",
        location: "Смолян",
        price: 245,
        seatsTotal: 40,
        organizerEmail: "teacher@trippilot.local",
      },
      {
        title: "Екскурзия до Рилския манастир",
        description: "Културно-историческа екскурзия с посещение на манастира, музейната част и беседа по литература и история.",
        category: "Екскурзия",
        targetGroup: "5В клас",
        eventDate: "2026-04-30",
        departureTime: "07:15",
        location: "Рилски манастир",
        price: 38,
        seatsTotal: 29,
        organizerEmail: "teacher.history@trippilot.local",
      },
      {
        title: "Пролетен STEM ден в София Тех Парк",
        description: "Посещение на технологични лаборатории, интерактивни демонстрации и кратки STEM работилници.",
        category: "Посещение на музей",
        targetGroup: "9А клас",
        eventDate: "2026-05-14",
        departureTime: "09:20",
        location: "София Тех Парк",
        price: 20,
        seatsTotal: 34,
        organizerEmail: "teacher.history@trippilot.local",
      },
      {
        title: "Финал на училищните лекоатлетически игри",
        description: "Училищен спортен ден с финални дисциплини, награждаване и участие на няколко класа.",
        category: "Спортен ден",
        targetGroup: "5-7 клас",
        eventDate: "2026-05-30",
        departureTime: "09:00",
        location: "Стадион Раковски",
        price: 8,
        seatsTotal: 70,
        organizerEmail: "teacher.sports@trippilot.local",
      },
      {
        title: "Коледен благотворителен концерт",
        description: "Празнично тържество с благотворителна кауза, сценична програма и участие на ученици и родители.",
        category: "Училищно тържество",
        targetGroup: "Цялото училище",
        eventDate: "2026-12-18",
        departureTime: "17:30",
        location: "Читалище Светлина",
        price: 5,
        seatsTotal: 220,
        organizerEmail: "teacher@trippilot.local",
      },
      {
        title: "Лятна екскурзия до Копривщица",
        description: "Маршрут с посещение на възрожденски къщи, интерактивен урок по история и свободно време за снимки.",
        category: "Екскурзия",
        targetGroup: "4А клас",
        eventDate: "2026-06-06",
        departureTime: "08:00",
        location: "Копривщица",
        price: 32,
        seatsTotal: 25,
        organizerEmail: "teacher@trippilot.local",
      },
      {
        title: "Отменено посещение на художествена галерия",
        description: "Планирано посещение на галерия с беседа по изобразително изкуство, което е отменено по организационни причини.",
        category: "Посещение на музей",
        targetGroup: "7А клас",
        eventDate: "2026-04-10",
        departureTime: "09:15",
        location: "Софийска градска художествена галерия",
        price: 15,
        seatsTotal: 30,
        organizerEmail: "teacher.history@trippilot.local",
        status: "cancelled",
      },
      {
        title: "Зелен лагер край язовир Батак",
        description: "Комбинирано зелено училище с екологични игри, наблюдение на природата и активности по екипи.",
        category: "Зелено училище",
        targetGroup: "6Б и 6В клас",
        eventDate: "2026-09-21",
        departureTime: "06:00",
        location: "Батак",
        price: 260,
        seatsTotal: 38,
        organizerEmail: "teacher@trippilot.local",
      },
      {
        title: "Тържество за първия учебен ден",
        description: "Откриване на учебната година с приветствие, кратка програма и представяне на класовете.",
        category: "Училищно тържество",
        targetGroup: "1-12 клас",
        eventDate: "2026-09-15",
        departureTime: "08:00",
        location: "Училищен двор",
        price: 0,
        seatsTotal: 300,
        organizerEmail: "teacher@trippilot.local",
      },
      {
        title: "Зимен спортен ден на Витоша",
        description: "Организиран зимен спортен ден със състезания, туристически маршрут и екипни активности на открито.",
        category: "Спортен ден",
        targetGroup: "9-12 клас",
        eventDate: "2026-12-12",
        departureTime: "07:30",
        location: "Витоша",
        price: 28,
        seatsTotal: 60,
        organizerEmail: "teacher.sports@trippilot.local",
      },
    ];

    for (const event of demoEvents) {
      this.ensureEvent(event, userIds, stats);
    }

    const demoRegistrations: SeedRegistration[] = [
      {
        eventTitle: "Зелено училище в Банско",
        studentEmail: "student.maria@trippilot.local",
        parentApprovalStatus: "approved",
        paymentStatus: "paid",
        seatNumber: "A5",
        status: "registered",
      },
      {
        eventTitle: "Зелено училище в Банско",
        studentEmail: "student.petar@trippilot.local",
        parentApprovalStatus: "approved",
        paymentStatus: "unpaid",
        seatNumber: "A6",
        status: "registered",
      },
      {
        eventTitle: "Екскурзия до Велико Търново и Арбанаси",
        studentEmail: "student.eli@trippilot.local",
        parentApprovalStatus: "pending",
        paymentStatus: "unpaid",
        seatNumber: "B3",
        status: "registered",
      },
      {
        eventTitle: "Екскурзия до Велико Търново и Арбанаси",
        studentEmail: "student.gabi@trippilot.local",
        parentApprovalStatus: "approved",
        paymentStatus: "paid",
        seatNumber: "B4",
        status: "registered",
      },
      {
        eventTitle: "Спортен ден на открито в Южния парк",
        studentEmail: "student.viktor@trippilot.local",
        parentApprovalStatus: "approved",
        paymentStatus: "unpaid",
        seatNumber: null,
        status: "registered",
      },
      {
        eventTitle: "Посещение на Техническия музей и планетариум",
        studentEmail: "student@trippilot.local",
        parentApprovalStatus: "approved",
        paymentStatus: "paid",
        seatNumber: "C2",
        status: "registered",
      },
      {
        eventTitle: "Лятна екскурзия до Копривщица",
        studentEmail: "student.maria@trippilot.local",
        parentApprovalStatus: "pending",
        paymentStatus: "unpaid",
        seatNumber: "12",
        status: "registered",
      },
      {
        eventTitle: "Отменено посещение на художествена галерия",
        studentEmail: "student.petar@trippilot.local",
        parentApprovalStatus: "rejected",
        paymentStatus: "unpaid",
        seatNumber: null,
        status: "cancelled",
      },
    ];

    for (const registration of demoRegistrations) {
      this.ensureRegistration(registration, userIds, stats);
    }

    if (stats.users + stats.events + stats.links + stats.registrations > 0) {
      const adminId = userIds.get("admin@trippilot.local") ?? null;

      this.run(
        `
          INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
          VALUES ($actorId, $action, $entityType, $entityId, $details);
        `,
        {
          $actorId: adminId,
          $action: "seed_demo_catalog",
          $entityType: "system",
          $entityId: "demo-catalog",
          $details: JSON.stringify({
            message: "Базата е обогатена с разнообразни demo събития, потребители, родителски връзки и регистрации.",
            stats,
          }),
        },
      );
    }
  }

  private ensureUser(user: SeedUser, stats: SeedStats): number {
    const existingUser = this.get<UserLookupRow>(
      `
        SELECT id
        FROM users
        WHERE email = $email;
      `,
      {
        $email: user.email,
      },
    );

    if (existingUser) {
      return Number(existingUser.id);
    }

    const userId = this.run(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($name, $email, $passwordHash, $role);
      `,
      {
        $name: user.name,
        $email: user.email,
        $passwordHash: bcrypt.hashSync(user.password, 10),
        $role: user.role,
      },
    );

    stats.users += 1;
    return userId;
  }

  private ensureParentStudentLink(parentEmail: string, studentEmail: string, userIds: Map<string, number>, stats: SeedStats): void {
    const parentId = userIds.get(parentEmail);
    const studentId = userIds.get(studentEmail);

    if (!parentId || !studentId) {
      return;
    }

    const existingLink = this.get<CountRow>(
      `
        SELECT COUNT(*) AS count
        FROM parent_student_links
        WHERE parent_id = $parentId AND student_id = $studentId;
      `,
      {
        $parentId: parentId,
        $studentId: studentId,
      },
    );

    if (Number(existingLink?.count ?? 0) > 0) {
      return;
    }

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

    stats.links += 1;
  }

  private ensureEvent(event: SeedEvent, userIds: Map<string, number>, stats: SeedStats): number | null {
    const existingEvent = this.get<IdRow>(
      `
        SELECT id
        FROM events
        WHERE title = $title AND event_date = $eventDate;
      `,
      {
        $title: event.title,
        $eventDate: event.eventDate,
      },
    );

    if (existingEvent) {
      return Number(existingEvent.id);
    }

    const organizerId = userIds.get(event.organizerEmail);

    if (!organizerId) {
      return null;
    }

    const eventId = this.run(
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
          status,
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
          $status,
          $organizerId
        );
      `,
      {
        $title: event.title,
        $description: event.description,
        $category: event.category,
        $targetGroup: event.targetGroup,
        $eventDate: event.eventDate,
        $departureTime: event.departureTime,
        $location: event.location,
        $price: event.price,
        $seatsTotal: event.seatsTotal,
        $status: event.status ?? "open",
        $organizerId: organizerId,
      },
    );

    stats.events += 1;
    return eventId;
  }

  private ensureRegistration(registration: SeedRegistration, userIds: Map<string, number>, stats: SeedStats): void {
    const studentId = userIds.get(registration.studentEmail);

    if (!studentId) {
      return;
    }

    const event = this.get<IdRow>(
      `
        SELECT id
        FROM events
        WHERE title = $title;
      `,
      {
        $title: registration.eventTitle,
      },
    );

    if (!event) {
      return;
    }

    const existingRegistration = this.get<CountRow>(
      `
        SELECT COUNT(*) AS count
        FROM registrations
        WHERE event_id = $eventId AND student_id = $studentId;
      `,
      {
        $eventId: Number(event.id),
        $studentId: studentId,
      },
    );

    if (Number(existingRegistration?.count ?? 0) > 0) {
      return;
    }

    this.run(
      `
        INSERT INTO registrations (
          event_id,
          student_id,
          parent_approval_status,
          payment_status,
          seat_number,
          status
        )
        VALUES (
          $eventId,
          $studentId,
          $parentApprovalStatus,
          $paymentStatus,
          $seatNumber,
          $status
        );
      `,
      {
        $eventId: Number(event.id),
        $studentId: studentId,
        $parentApprovalStatus: registration.parentApprovalStatus,
        $paymentStatus: registration.paymentStatus,
        $seatNumber: registration.seatNumber,
        $status: registration.status,
      },
    );

    stats.registrations += 1;
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
