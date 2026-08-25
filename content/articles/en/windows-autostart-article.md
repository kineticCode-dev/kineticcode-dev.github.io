---
title: "How to Autostart a Program on Windows"
description: "Do you have a program that you want to open automatically every time you start your computer? In this short guide, we will see how to do it quickly and easily using a built-in Windows tool called Task Scheduler."
date: "2026-07-18"
category: "software"
tags: ["Windows"]
---

# Table of Contents
1. [Introduction](#introduction)
2. [Step-by-Step Guide](#step-by-step-guide)
3. [Conclusion](#conclusion)

---

## Introduction
Sometimes, especially if you have developed your own software or use a specific app every day, it is very useful to have it start automatically when you log into Windows. We don't need to install any external software to do this. Windows has a perfect tool ready to use: the Task Scheduler.

## Step-by-Step Guide

Follow these simple steps to set up your autostart program:

1. **Open Task Scheduler**: Open the Windows Start menu and search for "Task Scheduler". Click on it to open the application.
2. **Create a Basic Task**: Look at the panel on the right side of the window and click on **"Create Basic Task..."**.
3. **Name Your Task**: Give your task a clear name (for example, "Start My Qt Software") and click **Next**.
4. **Choose the Trigger**: For the trigger, select **"When I log on"** (or "When the computer starts" if you prefer) and click **Next**.
5. **Choose the Action**: Select **"Start a program"** as the action and click **Next**.
6. **Select Your Program**: Click on **"Browse..."** and find the original executable file (usually a `.exe` file) of your program. Select it and click **Next**.
7. **Finish**: Review your settings and click on **Finish**.

And that's it! Your program is now scheduled to start automatically.

## Conclusion
Using the Windows Task Scheduler is a safe and clean way to manage programs that start with your computer. You can always go back to the Task Scheduler list to delete or modify this task if you change your mind later. 
