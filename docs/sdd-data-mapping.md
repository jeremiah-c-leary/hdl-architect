# SDD Data Mapping — DI-IPSC-81435

Working reference for how data from the FPGA diagram tool (hierarchy, Feature Arcs,
Feature Mapping diagrams, port/connection data) maps into each section of a
per-FPGA Software Design Description. One SDD is produced per FPGA.

Status key: **Confirmed** — template and field list locked. **Draft** — template
proposed, not yet locked. **Open** — not yet decomposed.

---

## Section-by-section map

| # | Section | Status | Data source |
|---|---|---|---|
| 1.1 | Identification | Confirmed | New metadata (system/CCA/FPGA name, ID, version) |
| 1.2 | System overview | Confirmed | New metadata + Section 2's reference list |
| 1.3 | Document overview | Deferred | Boilerplate text field (user-supplied) |
| 2 | Referenced documents | Draft | New: per-component references tab, aggregated |
| 3 | CSCI-wide design decisions | Open | Possibly a standard-phrase library (see below) |
| 4.1 | CSCI components | Confirmed | See dedicated section below — a few open items tracked in the index |
| 4.2 | Concept of execution | In progress | See dedicated section below — Feature Mapping diagrams, confirmed |
| 4.3 | Interface design | In progress | See dedicated section below — split with Section 5 confirmed |
| 5 | CSCI detailed design | Open | Tentative: per-leaf-component Feature Arcs |
| 6 | Requirements traceability | Open | — |
| 7 | Notes | Open | — |

---

## Open questions — not yet resolved

Tracked here so nothing gets lost or mistaken as settled by being deferred
into another section's own future work. Each links to its fuller writeup.

- **1.3** — editable per FPGA, or per system with an FPGA-level override?
- **Section 2** — which component types get the References tab: every type,
  or a narrower set (FPGA/CCA/System-level only)?
- **Section 3** — phrase-library organization, static-vs-template, and scope
  (personal / project-shared / tool-wide importable) — explicitly deferred
  until the rest of the document is decomposed. Now also needed for 4.2's
  own structure — see below — raising the priority of settling this.
- **4.2** — the group hierarchy 4.2 needs as its own document backbone
  isn't designed yet as a real data structure — same open structure
  question as Section 3's phrase library, now needed by two sections
  instead of one. ("Shallow" itself is resolved — see dedicated section.)
- **4.1.3** — requirements allocation: confirmed deferred to Section 6, to
  be designed there rather than piecemeal here. CWD allocation: the
  mechanism is designed (entity-default matrix on 4.1.2's own collapsed
  tree, leaves only, instance-level override) but still blocked on Section
  3 actually having CWD content to allocate.
- **4.1.4** — the `ipTags` library covers three of the DID's own four
  development-status categories (no current entry for "reengineered" or
  "new version of existing") — add them, or out of scope for these
  projects?
- **Known needed tool changes** (own section below) — the `instanceName`
  sharing bug, `entityName` not being user-definable, and the duplicated
  `ipTags` library. Not questions exactly, but confirmed, unresolved work
  items, held until the full document walkthrough is done.

---

## 1.1 Identification — Confirmed

**Template:**
> This SDD covers the {{FPGA_NAME}} ({{FPGA_ID}}) ({{FPGA_VERSION}}) FPGA on the
> {{CCA_NAME}} ({{CCA_ID}}) ({{CCA_VERSION}}) CCA for the {{SYSTEM_NAME}}
> ({{SYSTEM_ID}}) system.

**Filled example (invented placeholder values):**
> This SDD covers the FPGA Two (FPGA-0001) (Rev C) FPGA on the CCA Two (CCA-0001)
> (Rev B) CCA for the Example System (SYS-0001) system.

**Fields required:**

| Field | Level | Source |
|---|---|---|
| `SYSTEM_NAME` | System | New metadata |
| `SYSTEM_ID` | System | New metadata |
| `CCA_NAME` | CCA | Possibly auto: component `instanceName` |
| `CCA_ID` | CCA | New metadata |
| `CCA_VERSION` | CCA | New metadata |
| `FPGA_NAME` | FPGA | Possibly auto: component `instanceName` |
| `FPGA_ID` | FPGA | New metadata |
| `FPGA_VERSION` | FPGA | New metadata |

Note: the system carries no version field — a CCA is a physical board with its
own revision history; the system as a whole is a program-level identity that
doesn't version the same way.

---

## 1.2 System overview — Confirmed

**DID text (verbatim):**
> This paragraph shall briefly state the purpose of the system and the
> software to which this document applies. It shall describe the general
> nature of the system and software; summarize the history of system
> development, operation, and maintenance; identify the project sponsor,
> acquirer, user, developer, and support agencies; identify current and
> planned operating sites; and list other relevant documents.

**Template:**
> {{FPGA_NAME}} {{FPGA_PURPOSE}}. {{SYSTEM_NAME}} {{SYSTEM_PURPOSE}}.
> {{SYSTEM_HISTORY}}. The system is sponsored by {{SPONSOR}}, developed by
> {{DEVELOPER}}, for use by {{USER}}, with support provided by
> {{SUPPORT_AGENCY}}. Current operating sites include {{CURRENT_SITES}};
> planned sites include {{PLANNED_SITES}}. Related documents include
> {{RELATED_DOCS}}.

**Filled example (invented placeholder values):**
> FPGA Two supports UART-based serial communication and DAC frequency control.
> The Example System provides sensor fusion and control
> output for the host platform. The system originated as a
> follow-on to the earlier Example System generation and has been in continuous
> operation since 2019. The system is sponsored by the Program
> Office, developed by Example Developer Inc., for use by the Test organization,
> with support provided by Example Support Group. Current operating
> sites include Site A; planned sites include Site B. Related
> documents include the Example System/Subsystem Specification and the
> Example Interface Control Document.

**Fields required:**

| Field | Level | Source |
|---|---|---|
| `FPGA_PURPOSE` | FPGA | New metadata |
| `SYSTEM_PURPOSE` | System | New metadata |
| `SYSTEM_HISTORY` | System | New metadata |
| `SPONSOR` | System | New metadata |
| `DEVELOPER` | System | New metadata |
| `USER` | System | New metadata |
| `SUPPORT_AGENCY` | System | New metadata |
| `CURRENT_SITES` | System | New metadata |
| `PLANNED_SITES` | System | New metadata |
| `RELATED_DOCS` | System | Possibly shared with Section 2 |

**Follow-ups:**
- ~~Is `RELATED_DOCS` here the same underlying list as Section 2's "Referenced
  documents"?~~ Resolved — see Section 2 below: yes, same aggregated list,
  rendered as prose here instead of as citations.
- Is `SYSTEM_HISTORY` worth structuring at all, or is it thin enough per
  system to leave as a single free-text field? Still open.

---

## 1.3 Document overview — Deferred (boilerplate)

**DID text (verbatim):**
> This paragraph shall summarize the purpose and contents of this document and
> shall describe any security or privacy considerations associated with its
> use.

Skipped for now — existing boilerplate text is available for this section, and
it doesn't need the template/field treatment 1.1 and 1.2 got. Likely shape: a
pre-defined text box, pre-populated with standard boilerplate, left editable
per instance rather than assembled from structured fields.

**Open question:** editable per FPGA, or per system with an FPGA-level
override? Not yet decided — revisit when this section is picked back up.

---

## Section 2 — Referenced documents — Draft

**Approach:** a References tab on components, each entry holding title,
document number/ID, and date/revision — the three fields a real DID-style
citation needs. Section 2 is generated by walking the FPGA's own subtree,
collecting every reference attached anywhere within it, and deduplicating.
This is also the source for 1.2's `{{RELATED_DOCS}}` clause — same aggregated
list, rendered as prose there instead of as citations.

**Starting scope: option 1 — everything attached, anywhere in the subtree,
is included automatically**, regardless of whether the generated SDD text
actually cites it anywhere. Simpler to build now, and the only option that's
actually buildable before real narrative generation exists for sections like
4.2 and 5. Flagged for reassessment later: the DID's own convention is that
Section 2 lists documents actually cited in the body, so once narrative
generation exists, this may need to move to "only what's actually cited
in the generated text."

**Open question:** which component types get the References tab — every
component in the hierarchy (VendorIP, RegisterFile, etc.), or a narrower set
(FPGA/CCA/System-level only)? Not yet confirmed.

---

## Section 3 — CSCI-wide design decisions — Open

**DID text (verbatim):**
> This section shall be divided into paragraphs as needed to present
> CSCI-wide design decisions, that is, decisions about the CSCI's behavioral
> design (how it will behave, from a user's point of view, in meeting its
> requirements, ignoring internal implementation) and other decisions
> affecting the selection and design of the software units that make up the
> CSCI. If all such decisions are explicit in the CSCI requirements or are
> deferred to the design of the CSCI's software units, this section shall so
> state. Design decisions that respond to requirements designated critical,
> such as those for safety, security, or privacy, shall be placed in separate
> subparagraphs. If a design decision depends upon system states or modes,
> this dependency shall be indicated. Design conventions needed to understand
> the design shall be presented or referenced. Examples of CSCI-wide design
> decisions are the following:
> 1. Design decisions regarding inputs the CSCI will accept and outputs it
>    will produce, including interfaces with other systems, HWCIs, CSCIs, and
>    users.
> 2. Design decisions on CSCI behavior in response to each input or
>    condition, including actions performed, response times and performance
>    characteristics, physical systems modeled, selected
>    equations/algorithms/rules, and handling of disallowed inputs.
> 3. Design decisions on how databases/data files will appear to the user.
> 4. Selected approach to meeting safety, security, and privacy requirements.
> 5. Other CSCI-wide design decisions, such as approach to flexibility,
>    availability, and maintainability.

**Idea raised:** a library of standard, reusable phrases the user selects
from (checkboxes or similar) rather than free-text authoring each time,
since the same phrasing likely recurs across projects and possibly across
users. Two open design threads, deliberately deferred until the rest of the
document is worked through:

1. **Organization** — phrases tagged by the DID's own five example
   categories (so selection naturally produces a well-organized Section 3),
   vs. a flat, searchable list with no imposed structure.
2. **Static text vs. template** — some phrases may be usable verbatim across
   projects; others are closer to a template needing a field filled in per
   use (similar to 1.1/1.2's own templates). The library may need to support
   both.
3. **Scope** — personal library (private, no sharing), project/org-shared
   (team consistency across a shared system), or tool-wide importable
   (portable between unrelated users/organizations) — likely a JSON import
   format, consistent with how the tool already imports/exports hierarchy
   data, if the tool-wide case is wanted. Not mutually exclusive with each
   other. **Deferred — revisit after the rest of the document is decomposed.**

---

## 4.1 CSCI components — In progress

Appears once per FPGA's own SDD; each subsection below is a consolidated
table/listing walking every component in that FPGA's own hierarchy, not a
per-component write-up repeated six times (contrast with 4.3 and 5, which
use an `x` placeholder in the section number itself and genuinely do repeat,
once per interface / per software unit).

**4.1.1 — Confirmed.** DID text:
> Identify the software units that make up the CSCI. Each software unit
> shall be assigned a project-unique identifier.
>
> Note: A software unit is an element in the design of a CSCI... Software
> units may occur at different levels of a hierarchy and may consist of
> other software units... The SDD may refer to software units by any
> name(s) consistent with the design methodology being used.

The listing itself is free — the existing component hierarchy, walked in
full under the FPGA in question.

The "project-unique identifier" is new data, decided as follows:
- A **new, reader-facing identifier field**, separate from the component's
  existing internal id (the `comp38_ca08`-style id already used for wiring
  and feature-ref lookups) — kept distinct because the internal id isn't
  meant to be read by a document reviewer.
- **Generated at component-creation time**, and explicitly regenerated on
  copy/duplicate (a naive clone that copies the whole component object would
  otherwise carry the original's identifier over, defeating uniqueness).
- **No backfill/fallback for existing files** — the tool is still a
  prototype, so components created before this hook existed are out of
  scope for now.

**4.1.2 — In progress.** DID text:
> Show the static (such as "consists of") relationship(s) of the software
> units. Multiple relationships may be presented, depending on the selected
> software design methodology...

The underlying containment data is free — already present. Containment
("consists of") is the only static relationship that applies here; wiring/
connections belong under 4.3 Interface design instead. Scope: just the FPGA
in question and everything under it, not the CCA/System context above it
(already covered by 1.1/1.2).

Rendering approach: a collapsed tree, not a flat diagram or a fully-expanded
text outline — necessary once a design has many repeated subsystems, or
either form becomes unreadable. Worked example, confirmed against a mock-up:

```
FPGA
   +--- SCS_Subystem (1) [U_SCS]
             +--- Interrupt Controller (2) [U_INT_A, U_INT_B]
             +--- Reg file A (1) [U_REG_A]
             +--- axi4lite_crossbar_1s_2m (1) [U_XBAR]
             +--- Device ID (1) [U_DEVICE_ID]
   +--- Ethernet Subsystem (3) [U_Port_A, U_Port_B, U_Port_C]
             +--- MAC (1) [U_MAC]
             +--- FIFO (2) [U_RX_FIFO, U_TX_FIFO]
             +--- RX Filtering (1) [U_RX_FILTER]
             +--- axi4lite_crossbar_1s_2m (1) [U_CSR_XBAR]
```

**Collapsing rule:** duplicate *siblings* under the same parent collapse
into one row with a count, and their shared children are shown once, not
once per sibling (Ethernet Subsystem ×3 shows its own children a single
time, since all three instances are the same design). The *same* entity
reused in *different, unrelated* locations does **not** collapse across
locations — `axi4lite_crossbar_1s_2m` appears as a separate row at each
place it's used, each showing its own local count. The tree therefore shows
*where* each instance lives, not the total count of a given entity across
the whole design — that's a separate rollup (see below), not something the
tree itself answers.

**Duplicate-detection mechanism:** `entityName` (the existing, VHDL-style
`label : entity` field — shared, fixed type; distinct from `instanceName`,
the per-instance label). Two components sharing one `entityName`, created
via copy/paste, already share their underlying definition (same
`childSheetId` — confirmed: double-clicking either instance opens the same
sheet, and editing one's own internal content changes both). This is the
correct mechanism — see "Needed tool changes" below for the two things
required before it's fully trustworthy for this use.

**Separate rollup, not part of the tree:** a global count of instances per
unique `entityName`, walked across the *entire* design (not scoped to one
parent) — this is what actually answers "how many unique designs do I need
to create" for bidding purposes. Not yet designed; likely its own view
rather than part of 4.1.2's own tree.

**4.1.3 — In progress.** DID text:
> State the purpose of each software unit identified in 4.1.1. Identify the
> requirements and CSCI-wide design decisions allocated to it. (This
> information may be presented in tabular form. If it is presented elsewhere
> in this document, this paragraph may reference that presentation.)

Purpose half — **confirmed**: sourced from the existing `description` field
(already used elsewhere, shown in the tool's own Docs panel), not a new
field. Verified to correctly behave as entity-level shared data — same
description for every instance of the same design, for both Subsystems
(already confirmed tied to the shared child sheet) and leaf/Atomic
components (confirmed: text stays identical across copy/paste-linked
instances). No new tool change needed here, unlike `instanceName`.

Requirements half — **deferred to Section 6 (Requirements traceability),
confirmed.** The tool has no requirements concept at all yet — no
requirement IDs, no per-unit allocation, no traceability — so this is a
deliberate decision to design that concept once, in Section 6, rather than
partially here.

CSCI-wide design decisions half — **allocation mechanism now designed**
(Section 3's own content — the phrase-library work — remains separately
deferred; this settles only *how a CWD gets tied to a unit*, not *what CWDs
exist*):

- **Leaves only carry a real, checkable claim.** Same principle as the
  Consumer/self-loop rule from Feature Arcs — a subsystem that just wires a
  crossbar to a register file doesn't itself perform the behavior a CWD
  describes, so it can't claim one. A subsystem's own CWD picture is a
  **generated rollup** — the union of whatever's checked anywhere in its own
  subtree — shown for a reader's convenience, never something it claims
  directly.
- **A CWD's applicability defaults to the entity, not the instance.** Check
  `axi4lite_crossbar_1s_2m` once against a given CWD, and every instance of
  it inherits that by default — the common case (a reused leaf carries the
  same design intent everywhere it's placed) gets checked once, not once
  per instance.
- **UI: one matrix, built on 4.1.2's own collapsed tree**, not a separate,
  flat, entity-only view. Full tree structure stays visible — nothing
  disappears, so hierarchical context is preserved. The *first* occurrence
  of a given entity (in tree-walk order) gets a real, clickable checkbox per
  CWD column — this is where the entity-level default is actually set.
  Every *later* occurrence of that same entity still appears in its own,
  real position in the tree, but shown visually linked to the first
  (greyed / badged "same as ↑") rather than as an independent, clickable
  row.
- **Instance-level override, same interaction as the tree itself.** Clicking
  one of those greyed, linked duplicates breaks that one instance from the
  entity default and sets its own value — no separate override surface
  needed; the context-preserving view and the override mechanism are the
  same click.

Remaining to close this out: requirements still need Section 6 built from
scratch; CWDs themselves still need Section 3's own content (the
phrase-library work) before there's anything real to check boxes against —
the allocation *mechanism* is settled, but it has nothing to operate on yet.

**4.1.4 — In progress.** DID text:
> Identify the development status/type of each software unit — that is,
> whether it is new development; reengineered, using either reverse
> engineering or reengineering methods; software incorporated into the CSCI
> but not previously subjected to development or reengineering as part of
> the CSCI (such as reused code, or software bought "off the shelf"); or a
> new version or update of software previously developed, used, or tested.
> If applicable, identify the name, version, documentation, and library of
> any preexisting software, whether reused, reengineered, or off-the-shelf.

Status half — **confirmed**: the existing `ipTagId` (per-component) /
`ipTags` (library) mechanism. Current library has three categories: Third-
Party IP, Reused, New Development — mapping cleanly to three of the DID's
own four (Third-Party IP ≈ off-the-shelf). **Open:** "reengineered" and "new
version or update of existing" have no current category — add them, or are
they genuinely outside how these projects work?

Identifying-info half — **confirmed**: reuses the Section 2 References
metadata (title/number/date), no new field.

**Bug found while checking this — added to known tool changes below:** the
`ipTags` library is duplicated. Confirmed directly in project data: the same
three categories (Third-Party IP, Reused, New Development) appear **eight
times each**, 24 entries total instead of 3, each duplicate carrying its own
distinct id. Beyond clutter, this is a real correctness risk — two
components independently picking "Reused" from a dropdown pulling off this
library could land on two different underlying ids for what's meant to be
the same category, silently breaking any later grouping or counting by
status.

**4.1.5 — In progress.** DID text:
> Describe the CSCI's (and as applicable, each software unit's) planned
> utilization of computer hardware resources... Included for each computer
> hardware resource shall be: 1. The CSCI requirements or system-level
> resource allocations being satisfied 2. The assumptions and conditions on
> which the utilization data are based... 3. Any special considerations
> affecting the utilization... 4. The units of measure used... 5. The
> level(s) at which the estimates or measures will be made...

Checked directly against the existing device library (Vendor/Family/Device/
Resource Type/Value — each device's own total capacity) and the existing
hierarchical resource-utilization breakdown (per-component LUT/FF/DSP/
RAMB36/UltraRAM). Genuine partial match, item by item:

1. **Requirements/allocations satisfied — open, same gap as 4.1.3/Section
   6.** No requirements concept exists yet to tie a number to.
2. **Assumptions and conditions — confirmed N/A** for this tool's own use.
3. **Special considerations — confirmed N/A.** (DID's own examples are
   software-specific — virtual memory, OS overhead — with no clear hardware
   analog judged to matter here.)
4. **Units of measure — confirmed match.** The device library's own
   resource-type names (LUT6, DSP, RAMB36, etc.) already function as units,
   total device capacity is already tracked, and the live tool already
   computes percentage-of-capacity (used ÷ device total) — confirmed.
5. **Level(s) measured — confirmed match.** Breakdown is already
   hierarchical by component.

**4.1.6 — Confirmed.** DID text:
> Identify the program library in which the software that implements each
> software unit is to be placed.

New metadata: a free-text source-location field per component (SVN path,
git URL, whatever fits that particular source) — distinct from Section 2's
References tab, which cites documents *describing* a unit, not the
repository holding its actual source. Entity-level, like `description` —
shared automatically across every instance of the same design, since source
code is a property of the design itself, not of where a given instance sits
in the tree.

That closes out all six subsections of 4.1 — remaining open items (4.1.1's
References-tab component-type scope, 4.1.3's deferred requirements half,
4.1.4's category coverage) stay tracked in the Open Questions index above.

---

## Known needed tool changes (not new content — fixes to existing behavior)

Surfaced while decomposing 4.1.2. Items 1, 3, and 4 below are **fixed** —
addressed ahead of finishing the DID walkthrough, since they're bugs in
existing behavior rather than new DID-driven content, at the user's
explicit request. Item 2 remains open, deliberately held separate since
it's a new capability rather than a defect.

1. **✅ Fixed — `instanceName` was shared across copy/paste-linked
   instances; it's now always per-instance.** Root cause: `syncLinkedComponent`
   propagated `instanceName` to every component sharing a `linkedId`, the
   same as genuinely entity-level fields (ports, features, `description`,
   resources, etc.). Removed `instanceName` from that propagation — it's the
   one field that stays independent per instance, the VHDL label analog,
   while every other field there is correctly still shared. Verified:
   renaming one instance no longer affects any other; `description` and the
   rest still sync correctly.
2. **`entityName` cannot currently be user-defined.** It's fixed to the
   tool's own built-in palette (CCA, FPGA, HW, Hard Macro, RTL, Register
   File (CSR), Subsystem, Vendor IP) — there's no way today to name a new,
   specific reusable entity (`axi4lite_crossbar_1s_2m`, say) distinct from
   the generic built-in categories. Needed for `entityName`-based duplicate
   tracking (4.1.1's identifier, 4.1.2's collapsed tree, and the bidding
   rollup) to be meaningful for subsystem-level reuse, not just leaf-level
   implementation style. **Held separately — this is a new capability, not
   a defect, so it wasn't included in the bug-fix pass.**
3. **✅ Fixed — the `ipTags` library was duplicated.** Root cause: the
   default set (`defaultIpTags`) gets fresh, random ids every time state
   initializes, and the import-merge logic deduped by id alone — so the
   same conceptual "Reused" entry never matched across different sessions
   and just kept accumulating. Fixed by deduping on import by name instead
   (nothing else to compare for a tag), remapping any component's own
   `ipTagId` that pointed at a since-discarded duplicate onto the surviving
   entry. Verified against the actual project file that had accumulated 33
   entries: collapses to 3 on load, zero dangling references.
4. **✅ Fixed — the `protocols` library had the same duplication pattern,
   with live impact.** Same root cause as `ipTags`, plus a second layer:
   each signal within a protocol also carried its own random id
   (`newProtocolSignal`), so even a content-based comparison missed the
   match at first. Fixed by deduping on import by name plus a full
   structural match on roles and per-signal name/direction (deliberately
   ignoring each signal's own id) — a genuinely different custom protocol
   that happens to share a name would never be silently merged, only true
   duplicates are. Verified against the actual project file (22 entries
   collapsed to 2): every port that previously referenced a different
   "AXI4-Lite" duplicate — crossbar, PS, Serial Subsystem, DAC Control — now
   uniformly resolves to the same single entry, zero dangling references.
   This unblocks 4.3.x.6 (protocol characteristics) and Section 5's own
   per-component interface listing, both previously flagged as blocked on
   this bug.
5. **✅ Added — a protocol signal's own direction is now a dropdown built
   from that protocol's own roles, not free text.** Found while adding a
   custom SPI protocol: the direction field was a plain text box, entirely
   disconnected from the roles defined right above it. Now generates every
   ordered role pair (Master → Slave, Slave → Master for a 2-role protocol)
   as dropdown options. Migrated the built-in AXI4-Stream/AXI4-Lite
   protocols to the new full-role-name format (was the abbreviated "M→S"/
   "S→M") — both in the fresh defaults and, on file load, for any existing
   file still carrying the old abbreviation, ahead of the dedup pass (item 4
   above) so old- and new-format entries compare as identical rather than
   as spurious duplicates. Only that one, specifically-known abbreviation is
   migrated — an arbitrary custom protocol's own existing direction text is
   left untouched, since there's no general way to know what an unfamiliar
   abbreviation stood for; any such value stays visible as its own
   selectable option rather than being silently dropped when the dropdown
   renders, the same safeguard for a role that's since been renamed or
   deleted.
6. **✅ Added — protocols can now be organized into an arbitrary-depth
   grouping tree** (e.g. SPI → 4 wire → SPI_4W_MODE_0), edited through a
   two-pane creator: tree on the left, selected protocol's own definition
   on the right. Kept as a separate, purely organizational structure
   (`protocolGroups`, referencing `state.protocols` by id) rather than
   restructuring `state.protocols` itself — so nothing that already reads
   it as a flat list needed to change, including the dedup/migration logic
   above and the port picker. Deleting a group only removes the group;
   protocols inside stay defined, becoming ungrouped rather than deleted.
   Persists through both export paths, with the dedup fix's own id-remap
   extended to also fix up the grouping tree's own references when it
   runs, so nothing points at a since-discarded duplicate. **Deliberately
   out of scope for this pass:** where a protocol's own grouping should
   apply to the port-assignment picker used everywhere else in the tool —
   held open per the user's own call, to decide after using the tree for a
   while.

---

## 4.2 Concept of execution — In progress

**DID text (verbatim):**
> This paragraph shall describe the concept of execution among the software
> units. It shall include diagrams and descriptions showing the dynamic
> relationship of the software units, that is, how they will interact
> during CSCI operation, including, as applicable, flow of execution
> control, data flow, dynamically controlled sequencing, state transition
> diagrams, timing diagrams, priorities among units, handling of interrupts,
> timing/sequencing relationships, exception handling, concurrent execution,
> dynamic allocation/deallocation, dynamic creation/deletion of objects,
> processes, tasks, and other aspects of dynamic behavior.

**Source confirmed:** Feature Mapping's own sequence diagrams. Strong match
on flow of execution control, dynamically controlled sequencing (the
multi-occasion mechanism), and interrupt handling (already demonstrated in
this same design). Confirmed out of scope: timing — never used, not
convinced it's useful at this stage of the document.

**Guiding principle for this section, and how it relates to Section 5:**
> 4.2 is *what* the design does — shallow, but wide, across everything.
> Section 5 is *how* it does it — narrow, but deep, into any one unit.

This is the actual answer to "how much is enough," which is what made this
section hard to write in ordinary documentation practice before now: not a
fixed word count or diagram count, but a rule generation can follow. 4.2
stays light — the minimal diagrams needed for a reader to understand overall
operation, not a full accounting — with full internal detail deliberately
held back for wherever Section 5 goes deep into a specific unit.

**Mechanics:**
- **"Shallow" confirmed: the children of the FPGA component.** In practice
  this needs no new expansion-depth mechanism — a Feature Mapping diagram's
  own default, unexpanded state already shows exactly this (the FPGA's own
  direct children as collapsed boxes), provided the feature being exported
  is itself scoped at the FPGA's own level, not zoomed out to CCA or
  System (where the FPGA would be one collapsed box, hiding its own
  children entirely). Export mechanics reduce to: take whichever feature is
  scoped at the FPGA level, render its default (fully-collapsed) state,
  capture that as a static image. Nothing needs to be expanded further, and
  nothing needs walking to a depth — a document can't hold an interactive
  diagram anyway, so freezing the default state is the whole of it.
- Diagrams with multiple touches to the same entity (the multi-occasion
  work from earlier this session) are fine to include in full — not a
  concern at the feature-diagram level, distinct from the many-times-
  duplicated-subsystem concern that drove 4.1.2's own collapsed tree.
- Each feature needs its own doc-facing purpose/description — new metadata,
  distinct from a feature's own working name (precise for picking the right
  diagram in the editor, not written to explain *why* the feature exists to
  a reader) and distinct from a component's own `description`.

**Reactivates, and raises the priority of, the group-hierarchy question
deferred back in Section 3.** That was originally about organizing the
phrase library; it turns out to be the same underlying structure 4.2 itself
needs as its own document backbone — group name as a heading, features
underneath it. Not yet designed as a real data structure; still at the
"groupPath on each feature" idea stage from early in this conversation.

---

## 4.3 Interface design — In progress

**4.3 (top-level), verbatim:**
> This paragraph shall be divided into the following subparagraphs to
> describe the interface characteristics of the software units. It shall
> include both interfaces among the software units and their interfaces
> with external entities such as systems, configuration items, and users.
> If part or all of this information is contained in Interface Design
> Descriptions (IDDs), in section 5 of the SDD, or elsewhere, these sources
> may be referenced.

**4.3.1, Interface identification and diagrams, verbatim:**
> This paragraph shall state the project-unique identifier assigned to each
> interface and shall identify the interfacing entities... by name, number,
> version, and documentation references, as applicable. The identification
> shall state which entities have fixed interface characteristics... and
> which are being developed or modified... One or more interface diagrams
> shall be provided, as appropriate, to depict the interfaces.

Beyond 4.3.1, this is an `x`-placeholder section like Section 5 — 4.3.2
onward repeats once per interface, each with seven sub-subsections
(4.3.x.1–7: priority, interface type, data element characteristics, data
assembly characteristics, communication method, protocol, other/physical).
Not yet decomposed individually.

**Split confirmed, resolving the 4.3-vs-Section-5 overlap the DID itself
allows:** external interfaces (crossing the FPGA's own boundary) described
in 4.3; internal, inter-component interfaces (at any depth inside the FPGA)
described in Section 5, per component, alongside the protocol each of its
own ports uses.

**The external/internal split maps directly onto existing data — not new.**
A port's own `linkedBoundaryPortId` is already set when that port is wired
out to a boundary, null when wired directly to a sibling component. That's
exactly the discriminator needed: boundary-linked → candidate for 4.3;
unlinked → belongs in Section 5, whatever depth it's actually at.

**Protocol data confirmed as an existing, ready-made source, not new
metadata.** Every port already carries `protocolId` (into a shared
`protocols` library — AXI4-Stream, AXI4-Lite, with named signals and
Master/Slave roles), `protocolRole`, and `clockPortId`. Not every port uses
a named protocol (`protocolId: null` is common — raw signals like a UART's
own TX/RX line, or a bare interrupt wire, don't ride a standard bus). Feeds
both 4.3.x.6 (protocol characteristics) and Section 5's own per-component
interface listing. **No longer blocked** — the `protocols` library's own
duplication bug (known tool change #4) is fixed and verified.

---

## Tentative mappings — not yet decomposed

These are first impressions only, flagged for a real pass later:

- **5. CSCI detailed design** — possibly per-leaf-component Feature Arcs, one
  subsection per software unit.

---



These are first impressions only, flagged for a real pass later:

- **4.3 Interface design** — possibly port/connection data, independent of
  feature behavior.
- **5. CSCI detailed design** — possibly per-leaf-component Feature Arcs, one
  subsection per software unit.

---

## New data model additions identified so far

Metadata not currently tracked anywhere in the tool's data model:

**System-level** (entered once, shared across all FPGAs under it):
name, ID, purpose, history, sponsor, developer, user, support agency, current
operating sites, planned operating sites, related documents.

**CCA-level:** name (possibly auto), ID, version.

**FPGA-level:** name (possibly auto), ID, version, purpose.

**Other:** a boilerplate, editable text field for 1.3 Document overview —
level (FPGA vs. system-with-override) not yet decided. A References tab on
components (title, document number/ID, date/revision per entry) — scope of
which component types get it not yet confirmed. A reader-facing, per-
component identifier field for 4.1.1 (separate from the existing internal
id) — generated at creation and regenerated on copy, no backfill needed. A
free-text source-location field per component for 4.1.6 (SVN path, git URL,
etc.) — entity-level, shared across instances like `description`. A
doc-facing purpose/description field per **feature** for 4.2 — distinct
from a feature's own working name (precise for picking the right diagram in
the editor, not written to explain *why* it exists to a reader) and
distinct from a component's own `description`.
