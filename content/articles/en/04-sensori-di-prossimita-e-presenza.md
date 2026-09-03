---
title: "Inductive, capacitive, photoelectric, encoder: four different ways to let a machine see"
description: "How the most common industrial proximity sensors really work, when to choose one over another, and how to read a real datasheet."
date: "2026-09-01"
category: "automazione"
tags: ["Sensors", "Encoders", "Automation", "Fundamentals"]
---

In software, when you need to know whether something "exists" or "is in condition X", you write a boolean condition and the problem is solved. In the physical world, knowing whether a metal part has arrived at a certain position, whether a clear plastic container is full, or how many degrees a motor shaft has rotated, are three completely different problems, each requiring a different physical principle to be solved reliably. This article is the guide to the four sensors that solve 90% of the cases you'll encounter: inductive, capacitive, photoelectric, and encoder.

![Comparison of inductive, capacitive, photoelectric sensors and a rotary encoder](./img/sensor-types-comparison.svg)

## The inductive sensor: it only sees metals, but it sees them very well

The inductive sensor is probably the single most widespread proximity sensor in industrial automation, and the reason is simple: most of a machine's moving parts — cylinders, slides, arms — are metal, and inductive sensors are cheap, rugged, contactless, and practically insensitive to dirt, oil, and vibration.

The physical principle is elegant. Inside the sensor there's a coil generating a high-frequency electromagnetic field, which emerges from the sensor's sensing face. When a metal object enters this field, induced currents (called *eddy currents*) form inside it, drawing energy from the field. The sensor's internal circuit measures this energy loss — in practice, the damping of the coil's oscillation — and when it crosses a certain threshold, it switches the output. Notice the important detail: **the inductive sensor only detects conductive materials**, in practice almost exclusively metals. Plastic, wood, glass, liquids: to an inductive sensor they're transparent, they simply don't exist.

A parameter you'll always find in the datasheet is the **nominal sensing distance** (`Sn`), typically a few millimeters for the more compact sensors (the well-known cylindrical M8, M12, M18 types, where the number indicates the threaded diameter in millimeters) up to a few centimeters for larger models. You'll also find a distinction between **flush (embeddable)** and **non-flush (non-embeddable)** mounting: the former can be recessed completely flush into a metal bracket without this interfering with detection, the latter need free space around the sensing face — a detail that really matters on the mechanical drawings of the sensor bracket, and that if ignored produces sensors that "see" their own bracket instead of the part to be detected.

## The capacitive sensor: sees (almost) everything, even through a wall

Where the inductive sensor stops, the capacitive sensor comes in. It works in a conceptually similar way — it generates a field, this time electric rather than magnetic, and measures its variation — but it's sensitive to the **dielectric constant** of the approaching material, a property that almost every material has to some degree: plastic, glass, wood, liquids, even a person's hand. This makes it much more versatile but also "noisier": a poorly adjusted capacitive sensor can trip because of air humidity or dirt building up on its sensing face, so almost all industrial models have a sensitivity trimmer to adjust during installation — one of the few sensors that genuinely needs field calibration, not just mechanical positioning.

The textbook application is level detection through non-metallic walls: a capacitive sensor mounted on the outside of a plastic tank can detect whether the liquid inside has reached that point, with no need for any hole in the tank — a solution that, the first time you see it work, looks almost like magic.

## The photoelectric sensor: the longest range, the most intuitive principle

The photoelectric sensor uses a beam of light — almost always infrared, invisible to the eye but working perfectly in principle — and measures its interruption or reflection. There are three main configurations, and it's important to tell them apart because they radically change how you design their mounting on the machine:

**Through-beam.** A separate transmitter and receiver, mounted facing each other: when something interrupts the beam, the receiver detects it. It's the most reliable and longest-range configuration (even dozens of meters), but it requires aligning and wiring two separate components.

**Retro-reflective.** Transmitter and receiver in the same housing, with a reflector (a passive prismatic reflector, cheap and needing no power) mounted on the other side: the beam goes out, bounces off the reflector, and comes back. Only one active component to wire, intermediate range.

**Diffuse.** The sensor itself emits light and detects its direct reflection off the object, with no dedicated reflector at all. It's the easiest to install (a single component, no reflector) but the most sensitive to the object's color and surface finish: a dull black surface reflects far less light than a glossy white one, and this can drastically change the usable range — a detail well worth keeping in mind when the machine has to handle products of different colors.

## The encoder: when knowing "yes or no" isn't enough, and you need to know "how much"

All the sensors seen so far answer a binary question: present or absent. The encoder answers a completely different question: how much has something rotated (or translated), and sometimes at what speed. It's the sensor you'll find on a motor shaft, on a positioning axis, on any part of the machine where you need to know the exact position, not just a couple of states.

The most common type is the **incremental optical encoder**: a perforated disc fixed to the rotating shaft passes between a light emitter and receiver, generating a train of pulses every time a hole passes by. By counting the pulses, the PLC (or more often a dedicated high-speed counter module, because the frequency of these pulses can comfortably exceed the PLC's normal cyclic scan rate) reconstructs how much the shaft has rotated. Quality incremental encoders typically have two channels 90 degrees out of phase (called A and B), which let you not only count pulses but also determine the **direction** of rotation from the sequence in which the two channels switch — an elegant piece of engineering worth understanding, because it's the same principle used wherever a direction of movement needs to be detected from two phase-shifted digital signals.

The alternative is the **absolute encoder**, which instead of counting relative pulses directly returns, at any instant, the current absolute position (typically as a digital value over a communication bus), even right after power-up — an extremely valuable property for axes that can't afford a "homing" phase every time the machine restarts, such as the large positioning axes on a continuous production line.

## Reading a real datasheet: what to look for first

When you receive a physical component to commission, or need to check one for a replacement, the manufacturer's datasheet (Omron, Sick, Balluff, Pepperl+Fuchs are names you'll run into very often) always has a similar structure. The parameters to look at first, in order of practical priority: the supply voltage (almost always 10-30VDC, with 24VDC nominal), the output type (PNP/NPN, NO/NC — what you learned in the previous article), the nominal sensing distance, and, for inductive and capacitive sensors, whether it's flush or non-flush mount. If after reading these four lines you can already answer "this sensor is right for that position on the machine", you've learned exactly what you need to work safely in the field.

In the next article we move from "sensing" to "moving": asynchronous motors, servomotors, and inverters, and what really changes, from the control-software point of view, between these three worlds.
