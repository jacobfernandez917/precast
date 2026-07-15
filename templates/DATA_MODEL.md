# DATA_MODEL — Domain Data Model

> **Template + worked example.** Define your entities, their relationships, and
> the invariants that must always hold, _before_ writing schema or migrations.
> The example models the **meeting-room reservation** domain — replace with yours.

**Last updated:** [ISO date] · **Store:** PostgreSQL (see [TECH_STACK](../docs/TECH_STACK.md))

---

## 1. Entities

### User

The person making bookings. Identity is owned by Keycloak; we store a thin profile.

| Field         | Type        | Notes                    |
| ------------- | ----------- | ------------------------ |
| `id`          | uuid (PK)   | Mirrors Keycloak `sub`.  |
| `email`       | text unique | From the identity token. |
| `displayName` | text        |                          |
| `createdAt`   | timestamptz |                          |

### Room

A bookable physical space.

| Field       | Type      | Notes                        |
| ----------- | --------- | ---------------------------- |
| `id`        | text (PK) | Slug, e.g. `room-aspen`.     |
| `name`      | text      | Display name, e.g. "Aspen".  |
| `capacity`  | int       | Seats. Used by availability. |
| `floor`     | int       |                              |
| `amenities` | text[]    | e.g. `{"tv","whiteboard"}`.  |

### Reservation

A confirmed hold on a room for a time window.

| Field         | Type        | Notes                       |
| ------------- | ----------- | --------------------------- |
| `id`          | uuid (PK)   |                             |
| `roomId`      | text (FK)   | → Room.id                   |
| `organizerId` | uuid (FK)   | → User.id                   |
| `title`       | text        | Short meeting title.        |
| `startsAt`    | timestamptz |                             |
| `endsAt`      | timestamptz |                             |
| `status`      | enum        | `confirmed` \| `cancelled`. |
| `createdAt`   | timestamptz |                             |

## 2. Relationships

```
User 1───∞ Reservation ∞───1 Room
```

- A **User** organizes many **Reservations**.
- A **Room** has many **Reservations** (over disjoint time windows).

## 3. Invariants

1. **No overlap:** for a given `roomId`, no two `confirmed` reservations may have
   overlapping `[startsAt, endsAt)` ranges. Enforce with an exclusion constraint
   (`btree_gist` + `tstzrange`).
2. `endsAt` > `startsAt`.
3. Capacity is advisory at booking time — the agent filters by it, but the store
   does not reject an over-capacity request (people stand).
4. Cancelling sets `status = 'cancelled'`; rows are never hard-deleted (audit).

## 4. Example DDL sketch

```sql
create type reservation_status as enum ('confirmed', 'cancelled');

create table reservation (
  id            uuid primary key default gen_random_uuid(),
  room_id       text not null references room(id),
  organizer_id  uuid not null references "user"(id),
  title         text not null default 'Meeting',
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        reservation_status not null default 'confirmed',
  created_at    timestamptz not null default now(),
  constraint ends_after_start check (ends_at > starts_at),
  constraint no_overlap exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed')
);
```

## 5. Validation

Every external boundary validates with zod (see [STYLE_GUIDE](../docs/STYLE_GUIDE.md)).
The reservation input schemas live with the agent tools — keep them in sync with
this model. See [AGENT_SPEC.md](AGENT_SPEC.md).
