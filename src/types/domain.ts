export type Role = "student" | "teacher" | "parent" | "admin";

export type FlashType = "success" | "error";

export interface FlashMessage {
  type: FlashType;
  message: string;
}

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
}

export interface EventListItem {
  id: number;
  title: string;
  description: string;
  category: string;
  target_group: string;
  event_date: string;
  departure_time: string;
  location: string;
  price: number;
  seats_total: number;
  status: "open" | "cancelled";
  organizer_name: string;
  registered_count: number;
}

export interface EventDetails extends EventListItem {
  organizer_email: string;
}

export interface ParticipantRow {
  id: number;
  student_name: string;
  student_email: string;
  parent_approval_status: "pending" | "approved" | "rejected";
  payment_status: "paid" | "unpaid";
  seat_number: string | null;
  status: "registered" | "cancelled";
  created_at: string;
}

export interface ParentApprovalRow {
  registration_id: number;
  event_id: number;
  event_title: string;
  event_date: string;
  student_name: string;
  approval_status: "pending" | "approved" | "rejected";
}

export interface AuditLogRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  created_at: string;
  actor_name: string | null;
  actor_role: Role | null;
}
