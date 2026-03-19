import path from "node:path";

import bcrypt from "bcryptjs";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import { z } from "zod";

import { DatabaseManager } from "./db/database";
import type {
  AuditLogRow,
  CurrentUser,
  EventDetails,
  EventListItem,
  FlashMessage,
  ParentApprovalRow,
  ParticipantRow,
  Role,
} from "./types/domain";

const EVENT_CATEGORIES = [
  "Екскурзия",
  "Посещение на музей",
  "Зелено училище",
  "Училищно тържество",
  "Спортен ден",
] as const;

const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
const PAYMENT_STATUSES = ["paid", "unpaid"] as const;
const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: "student", label: "Ученик" },
  { value: "teacher", label: "Учител" },
  { value: "parent", label: "Родител" },
];

const registerSchema = z.object({
  name: z.string().trim().min(3, "Името трябва да е поне 3 символа."),
  email: z.string().trim().email("Въведи валиден имейл."),
  password: z.string().min(8, "Паролата трябва да е поне 8 символа."),
  role: z.enum(["student", "teacher", "parent"]),
  linkedStudentEmail: z.string().trim().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email("Въведи валиден имейл."),
  password: z.string().min(1, "Паролата е задължителна."),
});

const eventSchema = z.object({
  title: z.string().trim().min(5, "Заглавието трябва да е поне 5 символа."),
  description: z.string().trim().min(15, "Описанието трябва да е поне 15 символа."),
  category: z.enum(EVENT_CATEGORIES),
  targetGroup: z.string().trim().min(2, "Посочи клас или група."),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Невалидна дата."),
  departureTime: z.string().regex(/^\d{2}:\d{2}$/, "Невалиден час."),
  location: z.string().trim().min(2, "Посочи дестинация или локация."),
  seatsTotal: z.coerce.number().int().min(1, "Местата трябва да са поне 1."),
  price: z.coerce.number().min(0, "Цената не може да е отрицателна."),
});

const approvalSchema = z.object({
  approvalStatus: z.enum(APPROVAL_STATUSES),
});

const managementSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUSES),
  seatNumber: z.string().trim().max(20, "Номерът на мястото е твърде дълъг.").optional(),
});

const roleChangeSchema = z.object({
  role: z.enum(["student", "teacher", "parent", "admin"]),
});

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  is_active: number;
}

interface EventFormValues {
  title: string;
  description: string;
  category: (typeof EVENT_CATEGORIES)[number];
  targetGroup: string;
  eventDate: string;
  departureTime: string;
  location: string;
  seatsTotal: string;
  price: string;
}

interface AppOptions {
  dbPath?: string;
}

function mapUser(row: UserRow): CurrentUser {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: Number(row.is_active) === 1,
  };
}

function roleLabel(role: Role): string {
  switch (role) {
    case "student":
      return "Ученик";
    case "teacher":
      return "Учител";
    case "parent":
      return "Родител";
    case "admin":
      return "Админ";
    default:
      return role;
  }
}

function setFlash(req: Request, flash: FlashMessage): void {
  req.session.flash = flash;
}

function redirectWithError(req: Request, res: Response, url: string, message: string): void {
  setFlash(req, { type: "error", message });
  res.redirect(url);
}

function redirectWithSuccess(req: Request, res: Response, url: string, message: string): void {
  setFlash(req, { type: "success", message });
  res.redirect(url);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    redirectWithError(req, res, "/login", "Трябва да влезеш в системата.");
    return;
  }

  next();
}

function requireRoles(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.currentUser) {
      redirectWithError(req, res, "/login", "Трябва да влезеш в системата.");
      return;
    }

    if (!allowedRoles.includes(req.currentUser.role)) {
      res.status(403).render("error", {
        pageTitle: "Нямаш достъп",
        errorMessage: "Нямаш права за тази страница или действие.",
      });
      return;
    }

    next();
  };
}

function emptyEventForm(): EventFormValues {
  return {
    title: "",
    description: "",
    category: EVENT_CATEGORIES[0],
    targetGroup: "",
    eventDate: "",
    departureTime: "",
    location: "",
    seatsTotal: "25",
    price: "0",
  };
}

function countAvailableSeats(event: EventListItem | EventDetails): number {
  return Number(event.seats_total) - Number(event.registered_count);
}

export async function createApp(options: AppOptions = {}) {
  const database = new DatabaseManager(
    options.dbPath ?? process.env.DB_PATH ?? path.join(process.cwd(), "data", "trippilot.sqlite"),
  );
  await database.init();

  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "views"));

  app.use("/public", express.static(path.join(process.cwd(), "public")));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? "trippilot-dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  app.use((req, res, next) => {
    const flash = req.session.flash ?? null;
    req.session.flash = null;
    res.locals.flash = flash;
    res.locals.currentPath = req.path;
    res.locals.eventCategories = EVENT_CATEGORIES;
    res.locals.roleLabel = roleLabel;
    res.locals.formatPrice = (value: number) =>
      new Intl.NumberFormat("bg-BG", {
        style: "currency",
        currency: "BGN",
        minimumFractionDigits: 2,
      }).format(value);

    const sessionUserId = req.session.userId;

    if (typeof sessionUserId !== "number") {
      req.currentUser = null;
      res.locals.currentUser = null;
      next();
      return;
    }

    const user = database.get<UserRow>(
      `
        SELECT id, name, email, role, is_active
        FROM users
        WHERE id = $id;
      `,
      {
        $id: sessionUserId,
      },
    );

    if (!user || Number(user.is_active) !== 1) {
      req.session.userId = undefined;
      req.currentUser = null;
      res.locals.currentUser = null;
      next();
      return;
    }

    req.currentUser = mapUser(user);
    res.locals.currentUser = req.currentUser;
    next();
  });

  app.get("/", (req, res) => {
    if (!req.currentUser) {
      res.redirect("/login");
      return;
    }

    res.redirect("/events");
  });

  app.get("/register", (req, res) => {
    if (req.currentUser) {
      res.redirect("/events");
      return;
    }

    res.render("auth/register", {
      pageTitle: "Регистрация",
      formData: {
        name: "",
        email: "",
        password: "",
        role: "student",
        linkedStudentEmail: "",
      },
      roleOptions: ROLE_OPTIONS,
      errorMessage: null,
    });
  });

  app.post("/register", (req, res) => {
    if (req.currentUser) {
      res.redirect("/events");
      return;
    }

    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).render("auth/register", {
        pageTitle: "Регистрация",
        formData: {
          name: req.body.name ?? "",
          email: req.body.email ?? "",
          password: req.body.password ?? "",
          role: req.body.role ?? "student",
          linkedStudentEmail: req.body.linkedStudentEmail ?? "",
        },
        roleOptions: ROLE_OPTIONS,
        errorMessage: parsed.error.issues[0]?.message ?? "Невалидни данни за регистрация.",
      });
      return;
    }

    const existingUser = database.get<{ id: number }>(
      `
        SELECT id
        FROM users
        WHERE email = $email;
      `,
      {
        $email: parsed.data.email.toLowerCase(),
      },
    );

    if (existingUser) {
      res.status(400).render("auth/register", {
        pageTitle: "Регистрация",
        formData: {
          ...parsed.data,
          password: "",
        },
        roleOptions: ROLE_OPTIONS,
        errorMessage: "Вече има акаунт с този имейл.",
      });
      return;
    }

    const userId = database.run(
      `
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($name, $email, $passwordHash, $role);
      `,
      {
        $name: parsed.data.name,
        $email: parsed.data.email.toLowerCase(),
        $passwordHash: bcrypt.hashSync(parsed.data.password, 10),
        $role: parsed.data.role,
      },
    );

    if (parsed.data.role === "parent" && parsed.data.linkedStudentEmail) {
      database.linkParentToStudent(userId, parsed.data.linkedStudentEmail);
    }

    database.logAction(userId, "register_user", "user", String(userId), {
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
    });

    redirectWithSuccess(req, res, "/login", "Регистрацията беше успешна. Влез в системата.");
  });

  app.get("/login", (req, res) => {
    if (req.currentUser) {
      res.redirect("/events");
      return;
    }

    res.render("auth/login", {
      pageTitle: "Вход",
      formData: {
        email: "",
        password: "",
      },
      errorMessage: null,
    });
  });

  app.post("/login", (req, res) => {
    if (req.currentUser) {
      res.redirect("/events");
      return;
    }

    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).render("auth/login", {
        pageTitle: "Вход",
        formData: {
          email: req.body.email ?? "",
          password: "",
        },
        errorMessage: parsed.error.issues[0]?.message ?? "Невалидни login данни.",
      });
      return;
    }

    const user = database.get<UserRow & { password_hash: string }>(
      `
        SELECT id, name, email, role, is_active, password_hash
        FROM users
        WHERE email = $email;
      `,
      {
        $email: parsed.data.email.toLowerCase(),
      },
    );

    if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
      res.status(401).render("auth/login", {
        pageTitle: "Вход",
        formData: {
          email: parsed.data.email,
          password: "",
        },
        errorMessage: "Грешен имейл или парола.",
      });
      return;
    }

    if (Number(user.is_active) !== 1) {
      res.status(403).render("auth/login", {
        pageTitle: "Вход",
        formData: {
          email: parsed.data.email,
          password: "",
        },
        errorMessage: "Акаунтът е блокиран. Свържи се с администратор.",
      });
      return;
    }

    req.session.userId = Number(user.id);
    database.logAction(Number(user.id), "login", "session", String(user.id), {
      email: user.email,
    });

    redirectWithSuccess(req, res, "/events", "Влезе успешно в Trippilot.");
  });

  app.post("/logout", requireAuth, (req, res) => {
    const actorId = req.currentUser?.id ?? null;
    req.session.destroy(() => {
      if (actorId) {
        database.logAction(actorId, "logout", "session", String(actorId), {
          message: "Потребителят излезе от системата.",
        });
      }
      res.redirect("/login");
    });
  });

  app.get("/events", requireAuth, (req, res) => {
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const date = typeof req.query.date === "string" ? req.query.date.trim() : "";

    let sql = `
      SELECT
        e.id,
        e.title,
        e.description,
        e.category,
        e.target_group,
        e.event_date,
        e.departure_time,
        e.location,
        e.price,
        e.seats_total,
        e.status,
        u.name AS organizer_name,
        (
          SELECT COUNT(*)
          FROM registrations r
          WHERE r.event_id = e.id
            AND r.status = 'registered'
        ) AS registered_count
      FROM events e
      JOIN users u ON u.id = e.organizer_id
      WHERE 1 = 1
    `;

    const params: Record<string, string> = {};

    if (search) {
      sql += " AND (e.title LIKE $search OR e.target_group LIKE $search)";
      params.$search = `%${search}%`;
    }

    if (category) {
      sql += " AND e.category = $category";
      params.$category = category;
    }

    if (date) {
      sql += " AND e.event_date = $eventDate";
      params.$eventDate = date;
    }

    sql += " ORDER BY e.event_date ASC, e.departure_time ASC";

    const events = database.all<EventListItem>(sql, params).map((event) => ({
      ...event,
      price: Number(event.price),
      seats_total: Number(event.seats_total),
      registered_count: Number(event.registered_count),
    }));

    const studentRegistrations =
      req.currentUser?.role === "student"
        ? new Set(
            database
              .all<{ event_id: number }>(
                `
                  SELECT event_id
                  FROM registrations
                  WHERE student_id = $studentId
                    AND status = 'registered';
                `,
                {
                  $studentId: req.currentUser.id,
                },
              )
              .map((row) => Number(row.event_id)),
          )
        : new Set<number>();

    const parentApprovals =
      req.currentUser?.role === "parent"
        ? database.all<ParentApprovalRow>(
            `
              SELECT
                r.id AS registration_id,
                e.id AS event_id,
                e.title AS event_title,
                e.event_date,
                s.name AS student_name,
                r.parent_approval_status AS approval_status
              FROM registrations r
              JOIN parent_student_links psl ON psl.student_id = r.student_id
              JOIN users s ON s.id = r.student_id
              JOIN events e ON e.id = r.event_id
              WHERE psl.parent_id = $parentId
                AND r.status = 'registered'
              ORDER BY e.event_date ASC;
            `,
            {
              $parentId: req.currentUser.id,
            },
          )
        : [];

    res.render("events/list", {
      pageTitle: "Ученически екскурзии и училищни събития",
      events,
      filters: {
        q: search,
        category,
        date,
      },
      studentRegistrations,
      parentApprovals,
      countAvailableSeats,
    });
  });

  app.get("/events/new", requireRoles("teacher", "admin"), (_req, res) => {
    res.render("events/form", {
      pageTitle: "Нова екскурзия или училищно събитие",
      formAction: "/events",
      submitLabel: "Създай събитие",
      event: emptyEventForm(),
      errorMessage: null,
      isEdit: false,
    });
  });

  app.post("/events", requireRoles("teacher", "admin"), (req, res) => {
    const parsed = eventSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).render("events/form", {
        pageTitle: "Нова екскурзия или училищно събитие",
        formAction: "/events",
        submitLabel: "Създай събитие",
        event: {
          title: req.body.title ?? "",
          description: req.body.description ?? "",
          category: req.body.category ?? EVENT_CATEGORIES[0],
          targetGroup: req.body.targetGroup ?? "",
          eventDate: req.body.eventDate ?? "",
          departureTime: req.body.departureTime ?? "",
          location: req.body.location ?? "",
          seatsTotal: req.body.seatsTotal ?? "25",
          price: req.body.price ?? "0",
        },
        errorMessage: parsed.error.issues[0]?.message ?? "Невалидни данни за събитие.",
        isEdit: false,
      });
      return;
    }

    const eventId = database.run(
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
        $title: parsed.data.title,
        $description: parsed.data.description,
        $category: parsed.data.category,
        $targetGroup: parsed.data.targetGroup,
        $eventDate: parsed.data.eventDate,
        $departureTime: parsed.data.departureTime,
        $location: parsed.data.location,
        $price: parsed.data.price,
        $seatsTotal: parsed.data.seatsTotal,
        $organizerId: req.currentUser!.id,
      },
    );

    database.logAction(req.currentUser!.id, "create_event", "event", String(eventId), {
      title: parsed.data.title,
      targetGroup: parsed.data.targetGroup,
    });

    redirectWithSuccess(req, res, `/events/${eventId}`, "Събитието беше създадено успешно.");
  });

  app.get("/events/:id", requireAuth, (req, res) => {
    const eventId = Number(req.params.id);
    const event = database.get<EventDetails>(
      `
        SELECT
          e.id,
          e.title,
          e.description,
          e.category,
          e.target_group,
          e.event_date,
          e.departure_time,
          e.location,
          e.price,
          e.seats_total,
          e.status,
          u.name AS organizer_name,
          u.email AS organizer_email,
          (
            SELECT COUNT(*)
            FROM registrations r
            WHERE r.event_id = e.id
              AND r.status = 'registered'
          ) AS registered_count
        FROM events e
        JOIN users u ON u.id = e.organizer_id
        WHERE e.id = $id;
      `,
      {
        $id: eventId,
      },
    );

    if (!event) {
      res.status(404).render("not-found", {
        pageTitle: "Няма такова събитие",
        message: "Тази ученическа екскурзия или училищно събитие не беше намерено.",
      });
      return;
    }

    const normalizedEvent = {
      ...event,
      price: Number(event.price),
      seats_total: Number(event.seats_total),
      registered_count: Number(event.registered_count),
    };

    const studentRegistration =
      req.currentUser?.role === "student"
        ? database.get<{
            id: number;
            status: "registered" | "cancelled";
            parent_approval_status: "pending" | "approved" | "rejected";
            payment_status: "paid" | "unpaid";
          }>(
            `
              SELECT id, status, parent_approval_status, payment_status
              FROM registrations
              WHERE event_id = $eventId
                AND student_id = $studentId;
            `,
            {
              $eventId: eventId,
              $studentId: req.currentUser.id,
            },
          )
        : null;

    const parentLinkedRegistrations =
      req.currentUser?.role === "parent"
        ? database.all<ParentApprovalRow>(
            `
              SELECT
                r.id AS registration_id,
                e.id AS event_id,
                e.title AS event_title,
                e.event_date,
                s.name AS student_name,
                r.parent_approval_status AS approval_status
              FROM registrations r
              JOIN parent_student_links psl ON psl.student_id = r.student_id
              JOIN users s ON s.id = r.student_id
              JOIN events e ON e.id = r.event_id
              WHERE psl.parent_id = $parentId
                AND r.event_id = $eventId
                AND r.status = 'registered';
            `,
            {
              $parentId: req.currentUser.id,
              $eventId: eventId,
            },
          )
        : [];

    res.render("events/details", {
      pageTitle: normalizedEvent.title,
      event: normalizedEvent,
      studentRegistration,
      parentLinkedRegistrations,
      availableSeats: countAvailableSeats(normalizedEvent),
    });
  });

  app.get("/events/:id/edit", requireRoles("teacher", "admin"), (req, res) => {
    const eventId = Number(req.params.id);
    const event = database.get<{
      id: number;
      title: string;
      description: string;
      category: (typeof EVENT_CATEGORIES)[number];
      target_group: string;
      event_date: string;
      departure_time: string;
      location: string;
      price: number;
      seats_total: number;
    }>(
      `
        SELECT id, title, description, category, target_group, event_date, departure_time, location, price, seats_total
        FROM events
        WHERE id = $id;
      `,
      {
        $id: eventId,
      },
    );

    if (!event) {
      res.status(404).render("not-found", {
        pageTitle: "Няма такова събитие",
        message: "Не можем да редактираме несъществуващо училищно събитие.",
      });
      return;
    }

    res.render("events/form", {
      pageTitle: `Редакция: ${event.title}`,
      formAction: `/events/${eventId}/edit`,
      submitLabel: "Запази промените",
      event: {
        title: event.title,
        description: event.description,
        category: event.category,
        targetGroup: event.target_group,
        eventDate: event.event_date,
        departureTime: event.departure_time,
        location: event.location,
        seatsTotal: String(event.seats_total),
        price: String(event.price),
      },
      errorMessage: null,
      isEdit: true,
    });
  });

  app.post("/events/:id/edit", requireRoles("teacher", "admin"), (req, res) => {
    const eventId = Number(req.params.id);
    const parsed = eventSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).render("events/form", {
        pageTitle: "Редакция на събитие",
        formAction: `/events/${eventId}/edit`,
        submitLabel: "Запази промените",
        event: {
          title: req.body.title ?? "",
          description: req.body.description ?? "",
          category: req.body.category ?? EVENT_CATEGORIES[0],
          targetGroup: req.body.targetGroup ?? "",
          eventDate: req.body.eventDate ?? "",
          departureTime: req.body.departureTime ?? "",
          location: req.body.location ?? "",
          seatsTotal: req.body.seatsTotal ?? "25",
          price: req.body.price ?? "0",
        },
        errorMessage: parsed.error.issues[0]?.message ?? "Невалидни данни за редакция.",
        isEdit: true,
      });
      return;
    }

    const registrationCount = database.get<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM registrations
        WHERE event_id = $eventId
          AND status = 'registered';
      `,
      {
        $eventId: eventId,
      },
    );

    if (Number(registrationCount?.count ?? 0) > parsed.data.seatsTotal) {
      res.status(400).render("events/form", {
        pageTitle: "Редакция на събитие",
        formAction: `/events/${eventId}/edit`,
        submitLabel: "Запази промените",
        event: {
          title: req.body.title ?? "",
          description: req.body.description ?? "",
          category: req.body.category ?? EVENT_CATEGORIES[0],
          targetGroup: req.body.targetGroup ?? "",
          eventDate: req.body.eventDate ?? "",
          departureTime: req.body.departureTime ?? "",
          location: req.body.location ?? "",
          seatsTotal: req.body.seatsTotal ?? "25",
          price: req.body.price ?? "0",
        },
        errorMessage:
          "Броят места не може да бъде по-малък от броя вече записани ученици.",
        isEdit: true,
      });
      return;
    }

    database.run(
      `
        UPDATE events
        SET
          title = $title,
          description = $description,
          category = $category,
          target_group = $targetGroup,
          event_date = $eventDate,
          departure_time = $departureTime,
          location = $location,
          price = $price,
          seats_total = $seatsTotal
        WHERE id = $eventId;
      `,
      {
        $title: parsed.data.title,
        $description: parsed.data.description,
        $category: parsed.data.category,
        $targetGroup: parsed.data.targetGroup,
        $eventDate: parsed.data.eventDate,
        $departureTime: parsed.data.departureTime,
        $location: parsed.data.location,
        $price: parsed.data.price,
        $seatsTotal: parsed.data.seatsTotal,
        $eventId: eventId,
      },
    );

    database.logAction(req.currentUser!.id, "update_event", "event", String(eventId), {
      title: parsed.data.title,
    });

    redirectWithSuccess(req, res, `/events/${eventId}`, "Промените по събитието са запазени.");
  });

  app.post("/events/:id/cancel", requireRoles("teacher", "admin"), (req, res) => {
    const eventId = Number(req.params.id);

    database.run(
      `
        UPDATE events
        SET status = 'cancelled'
        WHERE id = $id;
      `,
      {
        $id: eventId,
      },
    );

    database.logAction(req.currentUser!.id, "cancel_event", "event", String(eventId), {
      reason: "Отменено от учител или админ.",
    });

    redirectWithSuccess(req, res, `/events/${eventId}`, "Събитието е отменено.");
  });

  app.post("/events/:id/register", requireRoles("student"), (req, res) => {
    const eventId = Number(req.params.id);
    const event = database.get<EventListItem>(
      `
        SELECT
          e.id,
          e.title,
          e.description,
          e.category,
          e.target_group,
          e.event_date,
          e.departure_time,
          e.location,
          e.price,
          e.seats_total,
          e.status,
          u.name AS organizer_name,
          (
            SELECT COUNT(*)
            FROM registrations r
            WHERE r.event_id = e.id
              AND r.status = 'registered'
          ) AS registered_count
        FROM events e
        JOIN users u ON u.id = e.organizer_id
        WHERE e.id = $id;
      `,
      {
        $id: eventId,
      },
    );

    if (!event) {
      redirectWithError(req, res, "/events", "Събитието не беше намерено.");
      return;
    }

    if (event.status !== "open") {
      redirectWithError(req, res, `/events/${eventId}`, "Не можеш да се запишеш за отменено събитие.");
      return;
    }

    if (countAvailableSeats({ ...event, registered_count: Number(event.registered_count) }) <= 0) {
      redirectWithError(req, res, `/events/${eventId}`, "Няма свободни места за това събитие.");
      return;
    }

    const existingRegistration = database.get<{
      id: number;
      status: "registered" | "cancelled";
    }>(
      `
        SELECT id, status
        FROM registrations
        WHERE event_id = $eventId
          AND student_id = $studentId;
      `,
      {
        $eventId: eventId,
        $studentId: req.currentUser!.id,
      },
    );

    if (existingRegistration?.status === "registered") {
      redirectWithError(req, res, `/events/${eventId}`, "Вече си записан за това събитие.");
      return;
    }

    if (existingRegistration?.status === "cancelled") {
      database.run(
        `
          UPDATE registrations
          SET
            status = 'registered',
            parent_approval_status = 'pending',
            payment_status = 'unpaid',
            seat_number = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $id;
        `,
        {
          $id: existingRegistration.id,
        },
      );
    } else {
      database.run(
        `
          INSERT INTO registrations (event_id, student_id)
          VALUES ($eventId, $studentId);
        `,
        {
          $eventId: eventId,
          $studentId: req.currentUser!.id,
        },
      );
    }

    database.logAction(req.currentUser!.id, "register_for_event", "registration", String(eventId), {
      eventId,
      studentId: req.currentUser!.id,
    });

    redirectWithSuccess(req, res, `/events/${eventId}`, "Записа се успешно за събитието.");
  });

  app.post("/events/:id/unregister", requireRoles("student"), (req, res) => {
    const eventId = Number(req.params.id);
    const registration = database.get<{ id: number }>(
      `
        SELECT id
        FROM registrations
        WHERE event_id = $eventId
          AND student_id = $studentId
          AND status = 'registered';
      `,
      {
        $eventId: eventId,
        $studentId: req.currentUser!.id,
      },
    );

    if (!registration) {
      redirectWithError(req, res, `/events/${eventId}`, "Нямаш активна регистрация за това събитие.");
      return;
    }

    database.run(
      `
        UPDATE registrations
        SET
          status = 'cancelled',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      {
        $id: registration.id,
      },
    );

    database.logAction(req.currentUser!.id, "unregister_from_event", "registration", String(registration.id), {
      eventId,
      studentId: req.currentUser!.id,
    });

    redirectWithSuccess(req, res, `/events/${eventId}`, "Отказът от участие беше записан.");
  });

  app.get("/events/:id/participants", requireRoles("teacher", "admin"), (req, res) => {
    const eventId = Number(req.params.id);
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const event = database.get<{ id: number; title: string }>(
      `
        SELECT id, title
        FROM events
        WHERE id = $id;
      `,
      {
        $id: eventId,
      },
    );

    if (!event) {
      res.status(404).render("not-found", {
        pageTitle: "Няма такова събитие",
        message: "Не можем да покажем участници за несъществуващо събитие.",
      });
      return;
    }

    let sql = `
      SELECT
        r.id,
        s.name AS student_name,
        s.email AS student_email,
        r.parent_approval_status,
        r.payment_status,
        r.seat_number,
        r.status,
        r.created_at
      FROM registrations r
      JOIN users s ON s.id = r.student_id
      WHERE r.event_id = $eventId
    `;

    const params: Record<string, string | number> = {
      $eventId: eventId,
    };

    if (search) {
      sql += " AND (s.name LIKE $search OR s.email LIKE $search)";
      params.$search = `%${search}%`;
    }

    sql += " ORDER BY s.name ASC";

    const participants = database.all<ParticipantRow>(sql, params);

    res.render("events/participants", {
      pageTitle: `Участници - ${event.title}`,
      event,
      participants,
      search,
    });
  });

  app.post("/registrations/:id/approval", requireRoles("parent"), (req, res) => {
    const registrationId = Number(req.params.id);
    const parsed = approvalSchema.safeParse(req.body);

    if (!parsed.success) {
      redirectWithError(req, res, "/events", "Невалиден статус за родителско потвърждение.");
      return;
    }

    const registration = database.get<{ id: number; event_id: number; student_id: number }>(
      `
        SELECT r.id, r.event_id, r.student_id
        FROM registrations r
        JOIN parent_student_links psl ON psl.student_id = r.student_id
        WHERE r.id = $registrationId
          AND psl.parent_id = $parentId;
      `,
      {
        $registrationId: registrationId,
        $parentId: req.currentUser!.id,
      },
    );

    if (!registration) {
      redirectWithError(req, res, "/events", "Нямаш достъп до тази регистрация.");
      return;
    }

    database.run(
      `
        UPDATE registrations
        SET
          parent_approval_status = $approvalStatus,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      {
        $approvalStatus: parsed.data.approvalStatus,
        $id: registrationId,
      },
    );

    database.logAction(req.currentUser!.id, "parent_approval", "registration", String(registrationId), {
      approvalStatus: parsed.data.approvalStatus,
    });

    redirectWithSuccess(req, res, `/events/${registration.event_id}`, "Статусът на родителското потвърждение е обновен.");
  });

  app.post("/registrations/:id/manage", requireRoles("teacher", "admin"), (req, res) => {
    const registrationId = Number(req.params.id);
    const eventId = Number(req.body.eventId);
    const parsed = managementSchema.safeParse(req.body);

    if (!parsed.success) {
      redirectWithError(req, res, `/events/${eventId}/participants`, "Невалидни данни за плащане или място.");
      return;
    }

    database.run(
      `
        UPDATE registrations
        SET
          payment_status = $paymentStatus,
          seat_number = $seatNumber,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      {
        $paymentStatus: parsed.data.paymentStatus,
        $seatNumber: parsed.data.seatNumber ? parsed.data.seatNumber : null,
        $id: registrationId,
      },
    );

    database.logAction(req.currentUser!.id, "manage_registration", "registration", String(registrationId), {
      paymentStatus: parsed.data.paymentStatus,
      seatNumber: parsed.data.seatNumber ?? null,
    });

    redirectWithSuccess(req, res, `/events/${eventId}/participants`, "Промените по участника са запазени.");
  });

  app.get("/admin", requireRoles("admin"), (_req, res) => {
    res.redirect("/admin/stats");
  });

  app.get("/admin/users", requireRoles("admin"), (req, res) => {
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
    let sql = `
      SELECT id, name, email, role, is_active
      FROM users
      WHERE 1 = 1
    `;

    const params: Record<string, string> = {};

    if (search) {
      sql += " AND (name LIKE $search OR email LIKE $search)";
      params.$search = `%${search}%`;
    }

    sql += " ORDER BY created_at DESC";

    const users = database.all<UserRow>(sql, params);

    res.render("admin/users", {
      pageTitle: "Потребители",
      users,
      search,
    });
  });

  app.post("/admin/users/:id/toggle-status", requireRoles("admin"), (req, res) => {
    const userId = Number(req.params.id);
    const user = database.get<UserRow>(
      `
        SELECT id, name, email, role, is_active
        FROM users
        WHERE id = $id;
      `,
      {
        $id: userId,
      },
    );

    if (!user) {
      redirectWithError(req, res, "/admin/users", "Потребителят не беше намерен.");
      return;
    }

    const newStatus = Number(user.is_active) === 1 ? 0 : 1;
    database.run(
      `
        UPDATE users
        SET is_active = $isActive
        WHERE id = $id;
      `,
      {
        $isActive: newStatus,
        $id: userId,
      },
    );

    database.logAction(req.currentUser!.id, "toggle_user_status", "user", String(userId), {
      isActive: newStatus === 1,
      targetEmail: user.email,
    });

    redirectWithSuccess(req, res, "/admin/users", "Статусът на потребителя беше обновен.");
  });

  app.post("/admin/users/:id/role", requireRoles("admin"), (req, res) => {
    const userId = Number(req.params.id);
    const parsed = roleChangeSchema.safeParse(req.body);

    if (!parsed.success) {
      redirectWithError(req, res, "/admin/users", "Невалидна роля.");
      return;
    }

    database.run(
      `
        UPDATE users
        SET role = $role
        WHERE id = $id;
      `,
      {
        $role: parsed.data.role,
        $id: userId,
      },
    );

    database.logAction(req.currentUser!.id, "change_user_role", "user", String(userId), {
      role: parsed.data.role,
    });

    redirectWithSuccess(req, res, "/admin/users", "Ролята на потребителя беше обновена.");
  });

  app.get("/admin/stats", requireRoles("admin"), (_req, res) => {
    const totalEvents = database.get<{ count: number }>("SELECT COUNT(*) AS count FROM events;");
    const totalRegistrations = database.get<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM registrations
        WHERE status = 'registered';
      `,
    );
    const totalUsers = database.get<{ count: number }>("SELECT COUNT(*) AS count FROM users;");
    const topEvent = database.get<{ title: string; registrations_count: number }>(
      `
        SELECT
          e.title,
          COUNT(r.id) AS registrations_count
        FROM events e
        LEFT JOIN registrations r
          ON r.event_id = e.id
         AND r.status = 'registered'
        GROUP BY e.id, e.title
        ORDER BY registrations_count DESC, e.title ASC
        LIMIT 1;
      `,
    );

    res.render("admin/stats", {
      pageTitle: "Статистика",
      summary: {
        totalEvents: Number(totalEvents?.count ?? 0),
        totalRegistrations: Number(totalRegistrations?.count ?? 0),
        totalUsers: Number(totalUsers?.count ?? 0),
        topEventTitle: topEvent?.title ?? "Няма данни",
        topEventRegistrations: Number(topEvent?.registrations_count ?? 0),
      },
    });
  });

  app.get("/admin/audit-logs", requireRoles("admin"), (req, res) => {
    const action = typeof req.query.action === "string" ? req.query.action.trim() : "";
    const date = typeof req.query.date === "string" ? req.query.date.trim() : "";

    let sql = `
      SELECT
        al.id,
        al.action,
        al.entity_type,
        al.entity_id,
        al.details,
        al.created_at,
        u.name AS actor_name,
        u.role AS actor_role
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.actor_user_id
      WHERE 1 = 1
    `;

    const params: Record<string, string> = {};

    if (action) {
      sql += " AND al.action LIKE $action";
      params.$action = `%${action}%`;
    }

    if (date) {
      sql += " AND date(al.created_at) = $createdAt";
      params.$createdAt = date;
    }

    sql += " ORDER BY al.created_at DESC LIMIT 50";

    const logs = database.all<AuditLogRow>(sql, params);

    res.render("admin/audit-logs", {
      pageTitle: "Audit log",
      logs,
      filters: {
        action,
        date,
      },
    });
  });

  app.use((_req, res) => {
    res.status(404).render("not-found", {
      pageTitle: "Страницата липсва",
      message: "Тази страница не беше намерена.",
    });
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).render("error", {
      pageTitle: "Възникна грешка",
      errorMessage: "Възникна неочаквана грешка. Опитай отново.",
    });
  });

  return app;
}
