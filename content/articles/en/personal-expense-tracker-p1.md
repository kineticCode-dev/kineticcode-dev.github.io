---
title: "Building a Personal Expense Tracker from Scratch: Architecture and Database Design (Part 1)"
description: "This article retraces the design and development process of a personal expense tracking web application. The goal isn't just to create a working tool, but to analyze every engineering decision and understand the 'why' behind our technological choices."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Database", "Supabase", "Frotend", "BaaS"]
---

This article retraces the design and development process of a personal expense tracking web application. The goal isn't just to create a working tool, but to analyze every engineering decision and understand the "why" behind our technological choices.

This project is meant to be educational but practical, keeping a professional approach without over-engineering or getting bogged down in unnecessary features. Let's dive in!

[Link to Github Repository](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Table of Contents
1. [Technical Specifications](#technical-specifications)
2. [Project Architecture](#project-architecture)
3. [Database Modeling](#database-modeling)
4. [Cloud Database Setup: Supabase](#cloud-database-setup-supabase)

---

## Technical Specifications

The objective is simple: build a personal expense tracker. The core ideas are:
- Develop a database to store all user expenses.
- Build a web app with a dual purpose:
  - Add, remove, or edit expenses in the database.
  - Display a summary dashboard with various charts (weekly, monthly expenses, etc.).

The typical use case: open the web app directly from a browser (PC, tablet, smartphone), add an expense, and visualize financial trends. To ensure it's functional for daily use, a cloud-based database is the preferred solution so the app is accessible 24/7.

While there are plenty of expense tracking apps out there, our goal is to learn the underlying technology by keeping only what is essential for the project's purpose.

## Project Architecture

The software is structured into distinct components. Initially, a standard 3-tier architecture was considered:
- **Frontend:** Graphical interface accessible via browser.
- **Backend:** Application to handle frontend requests and route them to the database.
- **Database:** Cloud-based data source.

However, by utilizing a modern Backend-as-a-Service (BaaS) cloud database, we can skip developing a custom backend API. For simplicity and efficiency, we will develop only the frontend in **Flutter**, which will communicate directly with our cloud database.

## Database Modeling

In this phase, we define the conceptual data structure, select our cloud provider, and configure the initial tables and relationships.

We need two distinct tables:
1. **Categories Table** (Tag)
2. **Expenses Table**

### 1. Categories Table
This table holds the different types of expenses.

| id    | category_name   |
| :---- | :-------------- |
| **1** | Groceries       |
| **2** | Car & Transport |
| **3** | Bills & Home    |
| **4** | Entertainment   |

### 2. Expenses Table
This table records each transaction.

| expense_id | amount | date | category_id | notes |
| :--- | :--- | :--- | :--- | :--- |
| **101** | 45.50 | 2026-07-06 | **1** | Weekly groceries at Conad |
| **102** | 62.00 | 2026-07-07 | **2** | Gas station |
| **103** | 12.50 | 2026-07-08 | **4** | Cinema with friends |
| **104** | 120.00 | 2026-07-08 | **3** | Electricity bill |
| **105** | 4.80 | 2026-07-08 | **1** | *empty* |

There is a **1:N (One-to-Many) relationship** between these two tables: the same category can belong to multiple rows in the expenses table. For example, a monthly mortgage payment will appear $N$ times in the expenses table, linked to the same category.

## Cloud Database Setup: Supabase

With our tables defined, we can configure our database using **Supabase**, an open-source Firebase alternative.

1. Create an account on the Supabase dashboard and start a new project.
2. You will be prompted to enter a database password (which the frontend will use to communicate with the DB). Leave other parameters at their default values.
3. Once the project is created, navigate to the **Table Editor** to create our two tables. The expenses table will have a foreign key pointing to the category ID.

### Table Definitions in Supabase:
**Categories Table (`tag`)**
- `id`: Unique identifier (Primary Key)
- `name`: Category name (e.g., mortgage, gas, groceries)

**Expenses Table (`expenses`)**
- `id`: Unique identifier (Primary Key)
- `amount`: Numeric value
- `date`: Transaction date
- `id_tag`: Foreign Key linked to the Categories table
- `notes`: Optional text

With the database created, we are ready to connect to it from our frontend and start inserting test data. You can find your database connection parameters (host, port, database name, user) in the Supabase dashboard under the connection settings (specifically selecting the transaction pooler).

---
*In Part 2, we will dive into setting up our Flutter frontend, connecting it to Supabase, and designing our user interface. Stay tuned!*
