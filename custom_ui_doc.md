# Custom UI Engine

## What it is

An LLM-driven middleware layer that sits between a user and an existing
enterprise application. The user types a request in natural language; the
engine parses the intent and renders ad-hoc UI blocks (buttons, forms,
dropdowns, selects) on top of the host app. Clicking a generated control
fires a predefined workflow against the underlying system.

Goal: replace deep menu trees and training-heavy operator flows with a
chat-driven, dynamically-rendered control surface.

## Problem

Enterprise software (ERP, CRM, OA, MES, etc.) tends to expose every
feature through nested menus and dense forms. New operators need long
ramp-up, advanced features stay unused, and the UI cannot adapt to the
specific task a user is trying to do right now. A static UI can't
collapse a complex flow into "the three controls this user needs for
this request."

## Approach

Three layers:

1. **Intent layer** — a lightweight open-source LLM, fine-tuned (LoRA)
   on the host app's domain, parses the user's NL request into a
   structured action.
2. **UI layer** — the server emits UI blocks (HTML / framework-agnostic
   schema) describing the controls needed for that action. The client
   renders them inline in the chat shell.
3. **Workflow layer** — each generated control is bound to a predefined
   workflow (script / API call / workflow engine such as Activiti or
   Camunda). Clicking the control executes the flow end-to-end.

A RAG store of the host app's manuals / FAQ / internal docs grounds the
intent layer so it stays accurate on domain-specific terminology.

## Scope of the demo

- Server-driven UI: server returns UI block descriptors, client renders.
- Scenario 1 is a literal gate-control flow (open / close / status), end
  to end through all three layers.
- Chat shell + structured output pattern is borrowed from AionUI; the
  Electron-specific pieces of that reference are not reused.

## Stack

- **LLM**: lightweight open-source model + LoRA fine-tune. Chosen for
  cost and on-prem deployability (信创-compatible).
- **Frontend**: HTML + a Web framework (Vue or React). Cross-platform via
  the browser; embeds into existing apps without a rewrite.
- **Backend**: Python or Java service exposing the intent + render API.
- **Workflow**: Python scripts and direct API calls for the demo;
  pluggable to Activiti / Camunda for production hosts.
- **RAG**: local vector store over the host app's docs.

## Roadmap

**Phase 1 — prototype (4 months).** Pick one pilot host app (e.g. CRM or
OA). Select and fine-tune the base LLM. Stand up the intent → render →
workflow loop on one representative scenario. First pass at the RAG
knowledge base.

**Phase 2 — pilot (8 months).** Deploy with 1–2 real customers in their
environment. Iterate on intent accuracy, UI block design, workflow
reliability. Harden the RAG layer with the customer's actual ops docs.

**Phase 3 — productize.** Package as a reusable component / SDK / SaaS so
it can be dropped into other host apps without bespoke integration work.

## Team

- Lead: Li Yaning (李亚宁)
- Engineering: 4 core engineers target (currently 1 frontend + 1 backend).
  Skills needed: LLM fine-tuning, Web frontend, backend + API design,
  workflow-engine integration.
