# Action Desk — Product Requirements

Build a working web application for individuals to track their own action items and get help planning their work. Each signed-in account has a private workspace. Records must persist in managed Postgres and remain available after reloading the app.

## Product and audience

The product title is **Action Desk**. Its mission is to help individuals capture, prioritize and complete their personal action items. The audience is individual professionals managing their own follow-up work. The initial app is a responsive collection workspace with create/edit forms, a searchable list and a conversational assistant. Use the existing APC design system; the person will choose the theme in the conversation.

## Data

Create one collection with identifier `actions`, label **Actions**, singular **Action**.

- `title`: **Title**, required text.
- `status`: **Status**, required choice of **Open**, **In progress**, **Done**.
- `priority`: **Priority**, required choice of **Low**, **Normal**, **High**.
- `due_date`: **Due date**, optional calendar date.
- `notes`: **Notes**, optional text.

Users can add, edit, delete and search their own actions. Another account must not read, edit or delete these records. The app must validate required fields and reject status or priority values outside the choices above. No shared team workspace is required.

## Assistant and services

Use the approved **Gemini** model connection and create a **managed Postgres** database. The assistant helps individuals clarify priorities and propose practical next steps using action details they provide in chat. It does not autonomously read or change saved records. The app must use real model and database connections, not mock them.

## Acceptance

1. A person can create an account and sign in.
2. They can create an action, change its status, reload and see the saved change.
3. Search finds a saved action by title; delete removes it.
4. Another account cannot list, edit or delete the first account's actions.
5. The conversational assistant answers through the real Gemini connection.

The folder name and exact APC theme are deliberately not specified. Ask for these missing choices one at a time. Build the complete initial app after they are supplied.
