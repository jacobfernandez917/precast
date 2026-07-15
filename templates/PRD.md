# PRD — Product Requirements Document

> **Template + worked example.** This is a feed-forward planning doc: fill it in
> _before_ building so any agent (or teammate) shares the same intent. The
> content below is a complete example for a **chat-based meeting room
> reservation** app — replace it with your product, keeping the section shape.

**Product:** RoomBooker — conversational meeting-room reservation
**Author:** [name]
**Status:** Draft · **Last updated:** [ISO date]

---

## 1. Problem

Booking a meeting room today means opening a calendar tool, hunting across
floors and time slots, and playing tetris with other people's holds. It is slow,
visual, and unforgiving of "I just need a room for 4 people in the next hour."

## 2. Goals

- Let anyone book a suitable room through a **single chat conversation**.
- Resolve fuzzy intent ("a big room tomorrow afternoon") into a concrete booking.
- Make the common path — _find + book_ — take under 20 seconds.

### Non-goals

- Recurring meetings and series editing (v2).
- Catering, equipment, or visitor management.
- Replacing the org calendar as system of record — we integrate, not replace.

## 3. Personas

| Persona           | Need                                                       |
| ----------------- | ---------------------------------------------------------- |
| **Ad-hoc booker** | "I need a room _now_ for a quick sync." Speed over choice. |
| **Organizer**     | Plans ahead; cares about capacity, floor, and A/V.         |
| **Facilities**    | Wants utilization data and no double-bookings.             |

## 4. User journeys (happy path)

1. User opens the chat and types _"book a room for 6 people tomorrow 2–3pm."_
2. Agent calls **check-availability**, offers the 2–3 matching rooms.
3. User picks one (or the agent picks the best fit and asks to confirm).
4. Agent calls **book-room**, confirms room name, time, and organizer back.

## 5. Scope (v1)

- Chat UI (web) backed by the reservation agent.
- Availability search by time window + minimum capacity.
- Booking + confirmation.
- Cancellation by reservation id.

## 6. Success metrics

| Metric                         | Target |
| ------------------------------ | ------ |
| Median time-to-book            | < 20 s |
| Booking completion rate        | > 85%  |
| Double-booking incidents       | 0      |
| Conversations needing fallback | < 10%  |

## 7. Risks & open questions

- **Ambiguous time parsing** — how do we handle timezones and "next Tuesday"?
- **Conflict at confirm-time** — room taken between search and book; need a retry.
- **Auth** — bookings are per-user (Keycloak identity); anonymous booking is out.

## 8. Traceability

- Data model → [DATA_MODEL.md](DATA_MODEL.md)
- Agent behavior → [AGENT_SPEC.md](AGENT_SPEC.md)
- UI/design language → [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)
