const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TableOfContents, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak,
} = require('docx');

// ---- palette ----
const GREEN = '2D8B4E';
const DARK = '1F5C36';
const LIGHTGREEN = 'E5F2EA';
const GREY = 'F1F3F5';
const AMBER = 'B45309';

const CONTENT_WIDTH = 9360; // US Letter, 1" margins

// ---- helpers ----
const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const cellBorders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 276 },
    children: [new TextRun({ text, ...opts })],
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 60, line: 264 },
    children: [new TextRun(text)],
  });
}
function num(text) {
  return new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    spacing: { after: 60, line: 264 },
    children: [new TextRun(text)],
  });
}

function cell(content, { width, shade, bold, color, span, valign } = {}) {
  const runs = Array.isArray(content) ? content : [content];
  return new TableCell({
    borders: cellBorders,
    margins: cellMargins,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: span,
    verticalAlign: valign || VerticalAlign.TOP,
    shading: shade ? { fill: shade, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    children: runs.map(t =>
      typeof t === 'string'
        ? new Paragraph({ spacing: { after: 0, line: 264 }, children: [new TextRun({ text: t, bold, color })] })
        : t
    ),
  });
}

function headerRow(labels, widths, shade = GREEN) {
  return new TableRow({
    tableHeader: true,
    children: labels.map((l, i) =>
      cell(l, { width: widths[i], shade, bold: true, color: 'FFFFFF' })
    ),
  });
}

function table(widths, rows) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows,
  });
}

function spacer(after = 120) {
  return new Paragraph({ spacing: { after }, children: [new TextRun('')] });
}

// ---- risk register data ----
// [hazard, who, risk (L/M/H), controls]
const risks = [
  ['Vehicle operation & driving (collisions, road conditions, reversing into kerbside/yards)',
   'Collectors, public',
   'High',
   'Licensed, fit drivers only; pre-start vehicle check (Appendix B); obey road rules & speed; no phone use while driving; reverse with care, use a spotter in tight yards; keep load secured; maintain following distance; plan route to minimise reversing.'],
  ['Manual handling — lifting/carrying bins & buckets, loading/unloading the van',
   'Collectors',
   'High',
   'Trained lifting technique; keep loads close, bend knees; two-person lift or trolley for full bins; do not overfill; use the van’s lowest load height; slide rather than lift where possible; rotate tasks; report any back/muscle discomfort early.'],
  ['Biological hazards — food-scrap pathogens, bioaerosols, mould, leachate, decomposition gases',
   'Collectors',
   'High',
   'Gloves at all times handling bins; wash/sanitise hands before eating/drinking; avoid touching face; keep cuts covered; ventilate van; do not inhale directly over decomposing waste; keep up to date with tetanus; clean & sanitise bins/equipment per schedule.'],
  ['Maggots, flies & pests in overfull or fouled bins',
   'Collectors',
   'Medium',
   'Gloves & eye protection when handling fouled bins; report infested sites for follow-up; keep bin lids closed in transit; sanitise affected bins; flag the site in the app report for accounts/operations.'],
  ['Slips, trips & falls — wet/greasy floors, alleys, stairs, uneven yards, loading area',
   'Collectors, public',
   'Medium',
   'Sturdy non-slip footwear; look before stepping; carry within clear sight lines; keep loading area tidy; take care on customer back-door ramps/stairs; do not rush; report site hazards via the app.'],
  ['Working alone / lone worker (solo runs, isolated sites, early starts)',
   'Collectors',
   'Medium',
   'Phone carried & charged; check-in procedure with base; share daily route; emergency contacts known; report concerns about a site; agreed escalation if a worker is unreachable.'],
  ['Unfamiliar customer premises — traffic, machinery, animals, restricted access',
   'Collectors',
   'Medium',
   'Follow site delivery instructions in the app; be visible; watch for forklifts/vehicles; do not enter restricted areas; be alert to dogs/animals; use the “how to find the bins” notes; report unsafe access.'],
  ['Sharps & contaminated items wrongly placed in food-scrap waste',
   'Collectors',
   'Medium',
   'Never reach blindly into a bin; tip/pour rather than hand-sort; gloves always; do not compress waste by hand; report contaminated bins; first-aid & incident process if a sharps injury occurs (seek medical advice promptly).'],
  ['Unloading & consolidation at the farm / community garden; compost piles (heat, dust, machinery)',
   'Collectors, site staff',
   'Medium',
   'Follow the destination site’s rules; keep clear of operating machinery; dust mask if turning/handling dry compost; stay clear of pile faces; mind footing on uneven ground; agreed drop-off zone.'],
  ['Hazardous substances — sanitisers / cleaning chemicals for bins & van',
   'Collectors',
   'Low',
   'Use per label/SDS; gloves & eye protection when decanting; never mix products; store sealed & labelled; keep SDS accessible; ventilate when cleaning.'],
  ['Fatigue & early-morning starts',
   'Collectors',
   'Medium',
   'Reasonable rostered hours; rest breaks; do not drive when fatigued; report fatigue; manage workload at peak periods.'],
  ['Environmental exposure — sun/UV, heat, cold, rain',
   'Collectors',
   'Low',
   'Sun protection (hat, sunscreen, sunglasses); hydration; weather-appropriate clothing; high-vis in poor visibility; reschedule non-urgent work in severe weather.'],
  ['Cross-contamination & vehicle hygiene',
   'Collectors, customers',
   'Low',
   'Clean spills promptly; routine van clean-down; keep cab separate from load; hand hygiene; covered transport.'],
];

const ratingMatrix = [
  ['', 'Minor', 'Moderate', 'Major / Serious harm'],
  ['Likely', 'Medium', 'High', 'High'],
  ['Possible', 'Low', 'Medium', 'High'],
  ['Unlikely', 'Low', 'Low', 'Medium'],
];

const vehicleChecks = [
  'Tyres — condition & pressure', 'Lights & indicators', 'Brakes (feel on first use)',
  'Mirrors clean & adjusted', 'Windscreen & wipers / washer', 'Horn',
  'Warrant of Fitness & registration current', 'Fluid levels (oil, coolant, screen wash)',
  'Load area clean & restraints available', 'First-aid kit & spill kit present',
  'Fuel / charge sufficient for route', 'No visible leaks or damage',
];

// ---- build document ----
const doc = new Document({
  creator: 'Green Loop',
  title: 'Green Loop Collections Health & Safety Plan',
  description: 'Health and safety plan for the food-scrap collection side of Green Loop operations',
  styles: {
    default: { document: { run: { font: 'Arial', size: 21 } } }, // ~10.5pt
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal',
        run: { size: 52, bold: true, color: DARK, font: 'Arial' },
        paragraph: { spacing: { after: 120 } } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, color: GREEN, font: 'Arial' },
        paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, color: DARK, font: 'Arial' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 280 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1080, hanging: 280 } } } },
      ]},
      { reference: 'numbers', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 280 } } } },
      ]},
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 2 } },
        children: [new TextRun({ text: 'Green Loop — Collections Health & Safety Plan', color: '888888', size: 16 })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        spacing: { before: 0 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 2 } },
        tabStops: [{ type: 'right', position: CONTENT_WIDTH }],
        children: [
          new TextRun({ text: 'Uncontrolled when printed', color: '888888', size: 16 }),
          new TextRun({ text: '\tPage ', color: '888888', size: 16 }),
          new TextRun({ children: [PageNumber.CURRENT], color: '888888', size: 16 }),
          new TextRun({ text: ' of ', color: '888888', size: 16 }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '888888', size: 16 }),
        ],
      })] }),
    },
    children: [
      // ---- Title page ----
      new Paragraph({ spacing: { before: 1600 }, children: [] }),
      new Paragraph({ style: 'Title', children: [new TextRun('Health & Safety Plan')] }),
      new Paragraph({ spacing: { after: 80 }, children: [
        new TextRun({ text: 'Food-Scrap Collection Operations', size: 32, color: GREEN, bold: true }),
      ]}),
      new Paragraph({ spacing: { after: 600 }, children: [
        new TextRun({ text: 'Green Loop — Taranaki', size: 24, color: '555555' }),
      ]}),
      new Paragraph({ spacing: { after: 80 }, children: [
        new TextRun({ text: 'This plan covers the collection, transport and drop-off of commercial food scraps — from loading the van, through customer pickups, to consolidation and unloading at the destination farm / community garden.', italics: true, color: '555555', size: 22 }),
      ]}),
      spacer(300),
      table([2600, 6760], [
        new TableRow({ children: [cell('Document', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('Collections Health & Safety Plan', { width: 6760 })] }),
        new TableRow({ children: [cell('Version', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('1.0 (draft for review)', { width: 6760 })] }),
        new TableRow({ children: [cell('Issued', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('June 2026', { width: 6760 })] }),
        new TableRow({ children: [cell('Prepared by', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('___________________________', { width: 6760 })] }),
        new TableRow({ children: [cell('Approved by (PCBU)', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('___________________________', { width: 6760 })] }),
        new TableRow({ children: [cell('Next review', { width: 2600, shade: LIGHTGREEN, bold: true }), cell('June 2027 (or after any notifiable event or significant change)', { width: 6760 })] }),
      ]),
      spacer(200),
      new Paragraph({ children: [new TextRun({ text: 'Note: This is a working template prepared to fit Green Loop’s collection operation. Names, contact numbers and site-specific details (marked “____”) must be completed, and the plan reviewed with workers, before it is relied upon.', size: 18, italics: true, color: AMBER })] }),

      new Paragraph({ children: [new PageBreak()] }),

      // ---- TOC ----
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] }),
      new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),

      new Paragraph({ children: [new PageBreak()] }),

      // ---- 1 Purpose & scope ----
      h1('1. Purpose & Scope'),
      p('Green Loop is a Person Conducting a Business or Undertaking (PCBU) under the Health and Safety at Work Act 2015 (HSWA). This plan sets out how Green Loop manages health and safety risks arising from its food-scrap collection operation so that workers and others are not harmed.'),
      p('Scope — this plan applies to all activities on the collection side of the operation:'),
      bullet('Loading empty bins, buckets and the welcome kit into the van before a run.'),
      bullet('Driving the collection route around the Taranaki / New Plymouth area.'),
      bullet('Collecting food-scrap bins and buckets from customer premises (including back-of-house areas, alleys, yards and community gardens).'),
      bullet('Transporting collected waste, and consolidating it into maturing bins.'),
      bullet('Unloading and dropping off at the destination farm / community garden.'),
      bullet('Cleaning, sanitising and maintaining bins, equipment and the vehicle.'),
      p('It applies to all Green Loop workers (employees and contractors), and considers the safety of customers, site staff and members of the public who may be affected by the work.'),

      // ---- 2 Policy ----
      h1('2. Health & Safety Commitment'),
      p('Green Loop is committed to providing a safe and healthy workplace and to meeting its duties under HSWA. So far as is reasonably practicable, Green Loop will:'),
      bullet('Provide and maintain a safe work environment, safe vehicles, plant and equipment.'),
      bullet('Identify hazards and eliminate or minimise risks to health and safety.'),
      bullet('Provide the information, training, instruction and supervision workers need to work safely.'),
      bullet('Engage with workers on matters that affect their health and safety, and enable their participation.'),
      bullet('Monitor the health of workers and the conditions at workplaces to prevent harm.'),
      bullet('Record, report and investigate incidents, and act to prevent recurrence.'),
      p('Everyone has a part to play. Workers must take reasonable care for their own safety and that of others, follow reasonable instructions and procedures, and report hazards and incidents.'),

      // ---- 3 Legislation ----
      h1('3. Legislative Framework'),
      p('This plan is framed around:'),
      bullet('Health and Safety at Work Act 2015 (HSWA) — primary duties of PCBUs, officers and workers.'),
      bullet('Health and Safety at Work (General Risk and Workplace Management) Regulations 2016 — managing risks, first aid, emergency plans, facilities.'),
      bullet('Health and Safety at Work (Hazardous Substances) Regulations 2017 — for cleaning/sanitising chemicals.'),
      bullet('Land Transport Act 1998 and road rules — driver licensing and safe vehicle operation.'),
      bullet('Relevant WorkSafe New Zealand guidance and good-practice codes.'),
      p('Where this plan and the law differ, the law prevails. WorkSafe is the regulator; certain serious events are notifiable (see Section 11).'),

      // ---- 4 Roles ----
      h1('4. Roles & Responsibilities'),
      h2('PCBU (Green Loop)'),
      bullet('Holds the primary duty of care; ensures this plan is resourced, implemented and reviewed.'),
      bullet('Provides safe vehicles, equipment, PPE, training and safe systems of work.'),
      h2('Officers (owners / directors)'),
      bullet('Exercise due diligence to ensure Green Loop meets its duties — understand the operation’s hazards, ensure resources and processes are in place, and verify they are used.'),
      h2('Supervisor / Operations lead'),
      bullet('Day-to-day implementation: inductions, route planning, vehicle checks, incident response, and keeping records.'),
      bullet('Acts on hazard and incident reports (including those flagged through the collector app).'),
      h2('Workers (collectors / specialists)'),
      bullet('Take reasonable care for their own and others’ safety.'),
      bullet('Follow safe work procedures, wear the required PPE, and use equipment correctly.'),
      bullet('Report hazards, near-misses and incidents promptly.'),
      bullet('Do not start or continue work they reasonably believe is unsafe — stop and escalate.'),
      h2('Contractors, customers & visitors'),
      bullet('Contractors follow this plan and their own safe practices.'),
      bullet('Customers are expected to provide reasonable, safe access to bins; access problems are reported and managed.'),

      // ---- 5 Worker engagement ----
      h1('5. Worker Engagement & Participation'),
      p('Because the team is small and mobile, engagement is kept practical:'),
      bullet('Health and safety is a standing item in team catch-ups; workers are encouraged to raise concerns any time.'),
      bullet('Workers are consulted when hazards are identified, when procedures change, and when new equipment or routes are introduced.'),
      bullet('The collector app’s report function lets drivers flag site hazards, access issues and incidents from the field; these are reviewed by the operations lead.'),
      bullet('Workers are told what action was taken on what they raised.'),

      // ---- 6 Risk management process ----
      h1('6. How We Manage Risk'),
      p('Green Loop uses a simple, continuous process:'),
      num('Identify hazards — from the tasks above, worker reports, incidents and site visits.'),
      num('Assess the risk — how likely, and how serious, using the rating guide in Appendix A.'),
      num('Control the risk — applying the hierarchy of controls (below), preferring elimination.'),
      num('Review — check controls are working and update after incidents or changes.'),
      h2('Hierarchy of controls'),
      bullet('Eliminate — remove the hazard (e.g. don’t collect overfilled/unsafe bins; redesign access).'),
      bullet('Substitute / Isolate / Engineer — trolleys & lifting aids, lower load heights, ventilation, vehicle safety features.'),
      bullet('Administrative — safe procedures, training, route planning, check-ins, rest breaks.'),
      bullet('PPE — gloves, footwear, hi-vis, eye/respiratory protection as the last line of defence.'),

      // ---- 7 Risk register ----
      h1('7. Collection Risk Register'),
      p('The table below records the main hazards on the collection side, who is at risk, an initial risk rating, and the controls in place. It is reviewed regularly and after any incident.'),
      table([2600, 1300, 900, 4560], [
        headerRow(['Hazard', 'Who is at risk', 'Risk', 'Key controls'], [2600, 1300, 900, 4560]),
        ...risks.map(r => new TableRow({ children: [
          cell(r[0], { width: 2600 }),
          cell(r[1], { width: 1300 }),
          cell(r[2], { width: 900, shade: r[2] === 'High' ? 'F8D7DA' : r[2] === 'Medium' ? 'FFF3CD' : 'D4EDDA', bold: true }),
          cell(r[3], { width: 4560 }),
        ]})),
      ]),

      // ---- 8 PPE ----
      h1('8. Personal Protective Equipment (PPE)'),
      p('Green Loop provides PPE; workers must wear it and keep it in good condition. Minimum PPE for collection work:'),
      bullet('Gloves — worn whenever handling bins, buckets, waste or during cleaning.'),
      bullet('Sturdy, closed, non-slip footwear (safety footwear recommended).'),
      bullet('High-visibility top or vest when on the road, in yards, or in low light.'),
      bullet('Eye protection when handling fouled bins, decanting chemicals, or near dust.'),
      bullet('Dust mask / respirator when handling dry compost or in dusty conditions.'),
      bullet('Sun protection (hat, sunscreen, sunglasses) for outdoor work.'),
      p('Damaged or worn PPE is reported and replaced. Hand-washing/sanitising is expected before eating, drinking or touching the face.'),

      // ---- 9 Safe work procedures ----
      h1('9. Safe Work Procedures'),
      h2('9.1 Before the run — loading the van'),
      bullet('Complete the pre-start vehicle check (Appendix B).'),
      bullet('Load empty bins/buckets and the day’s welcome kit(s); secure the load so nothing shifts.'),
      bullet('Confirm first-aid kit and spill kit are on board; phone charged.'),
      h2('9.2 Manual handling'),
      bullet('Assess the load first — if it is too heavy or awkward, use a trolley or get help.'),
      bullet('Keep the load close, feet stable, bend the knees, keep the back in its natural curve, and avoid twisting.'),
      bullet('Slide or wheel loads rather than lifting where possible; do not overreach into the van.'),
      bullet('Don’t overfill bins; split loads. Report any strain or discomfort early.'),
      h2('9.3 At the customer site'),
      bullet('Follow the site’s access and “how to find the bins” notes in the app.'),
      bullet('Park safely and legally; be aware of traffic, pedestrians, machinery and animals.'),
      bullet('Inspect the bin before lifting — watch for overfilling, sharps, foul contents or pests.'),
      bullet('Do not hand-sort or reach blindly into waste. Tip/pour to transfer.'),
      bullet('Leave the area tidy; report any site hazard or access problem via the app report.'),
      h2('9.4 Transport & consolidation'),
      bullet('Keep the load secured and covered; keep the cab clean and separate from the load.'),
      bullet('Drive to conditions; take rostered breaks; never drive fatigued or distracted.'),
      bullet('Consolidate bins as trained; keep clear of capacity limits and lift safely.'),
      h2('9.5 Drop-off at the farm / community garden'),
      bullet('Follow the destination site’s rules and agreed drop-off zone.'),
      bullet('Keep clear of operating machinery and compost-pile faces; mind footing on uneven ground.'),
      bullet('Use a dust mask if handling dry compost.'),
      h2('9.6 Cleaning, hygiene & spills'),
      bullet('Clean and sanitise bins and equipment on the agreed schedule and after fouling.'),
      bullet('Use chemicals per the label/SDS; gloves and eye protection when decanting; never mix products.'),
      bullet('Clean up leachate/spills promptly with the spill kit; bag and dispose of contaminated material appropriately.'),
      bullet('Wash hands thoroughly before eating, drinking or leaving the work.'),

      // ---- 10 Emergency ----
      h1('10. Emergency Procedures'),
      h2('Immediate priorities'),
      num('Make the scene safe and protect yourself first.'),
      num('Render first aid; call 111 for any serious injury, fire or medical emergency.'),
      num('Notify the operations lead as soon as it is safe to do so.'),
      h2('Vehicle crash or breakdown'),
      bullet('Pull over safely, switch on hazards; if a crash with injury, call 111.'),
      bullet('Exchange details as required; do not move seriously injured people unless in danger.'),
      bullet('Arrange recovery; secure the load; report to the operations lead.'),
      h2('Spill / leachate release'),
      bullet('Contain with the spill kit; prevent entry to drains/waterways; clean and disinfect.'),
      bullet('Report significant spills to the operations lead.'),
      h2('Sharps / biological exposure injury'),
      bullet('Wash the wound, encourage bleeding, cover; seek medical advice promptly.'),
      bullet('Record the incident and review how it happened.'),
      h2('Emergency contacts'),
      table([3120, 6240], [
        new TableRow({ children: [cell('Emergency services', { width: 3120, shade: GREY, bold: true }), cell('111 (Police / Fire / Ambulance)', { width: 6240 })] }),
        new TableRow({ children: [cell('Operations lead', { width: 3120, shade: GREY, bold: true }), cell('Name: ______________  Phone: ______________', { width: 6240 })] }),
        new TableRow({ children: [cell('After-hours / officer', { width: 3120, shade: GREY, bold: true }), cell('Name: ______________  Phone: ______________', { width: 6240 })] }),
        new TableRow({ children: [cell('Vehicle recovery / insurer', { width: 3120, shade: GREY, bold: true }), cell('______________________________', { width: 6240 })] }),
        new TableRow({ children: [cell('WorkSafe (notifiable events)', { width: 3120, shade: GREY, bold: true }), cell('0800 030 040  —  worksafe.govt.nz', { width: 6240 })] }),
      ]),

      // ---- 11 Incident reporting ----
      h1('11. Incident Reporting & Investigation'),
      p('All injuries, near-misses and significant hazards are reported — in the field via the app report function where possible, and to the operations lead. Reports are recorded (Appendix C) and reviewed so controls can be improved.'),
      h2('Notifiable events — WorkSafe'),
      p('Some events must be notified to WorkSafe as soon as possible (and the scene preserved). A notifiable event is a death, a notifiable injury or illness, or a notifiable incident arising from work. Notifiable injuries/illnesses include, for example:'),
      bullet('An injury requiring (or likely to require) hospital admission — e.g. a serious laceration, serious head/eye injury, fracture, or amputation.'),
      bullet('A serious infection or illness attributable to the work (relevant to handling organic waste).'),
      bullet('A notifiable incident exposing a person to serious risk — e.g. an uncontrolled spill or a vehicle incident with potential for serious harm.'),
      p('If unsure whether an event is notifiable, treat it as notifiable and call WorkSafe on 0800 030 040. Notifiable events are recorded and kept for at least 5 years.'),

      // ---- 12 Training ----
      h1('12. Training, Induction & Competency'),
      bullet('Every worker completes a health & safety induction covering this plan, the hazards, PPE and emergency procedures before working unsupervised.'),
      bullet('Drivers hold a current, appropriate driver licence and are fit to drive.'),
      bullet('Workers are trained in safe manual handling and safe waste-handling/hygiene practices.'),
      bullet('Training and inductions are recorded (Appendix D). Refreshers are provided after incidents or changes.'),

      // ---- 13 Health & wellbeing ----
      h1('13. Health Monitoring & Wellbeing'),
      bullet('Workers are encouraged to report early signs of strain, illness or fatigue.'),
      bullet('Tetanus immunisation is recommended for workers handling organic waste; cuts are kept covered.'),
      bullet('Workloads and rosters are managed to limit fatigue, especially at peak periods and early starts.'),
      bullet('Drugs and alcohol must not impair a worker’s ability to work safely — never drive or work impaired.'),

      // ---- 14 Vehicle & equipment ----
      h1('14. Vehicle & Equipment Maintenance'),
      bullet('Vehicles are kept roadworthy with current WoF and registration, and serviced per schedule.'),
      bullet('A pre-start check (Appendix B) is completed before each run; defects are reported and unsafe vehicles taken out of service.'),
      bullet('Bins, trolleys, lifting aids and PPE are inspected, cleaned and replaced as needed.'),
      bullet('First-aid and spill kits are kept stocked and on board.'),

      // ---- 15 Contractors & visitors ----
      h1('15. Contractors & Visitors'),
      bullet('Contractors are given relevant parts of this plan and must work safely; duties are coordinated where work overlaps.'),
      bullet('At customer and destination sites, Green Loop workers follow that site’s reasonable safety rules, and the site is expected to provide safe access.'),

      // ---- 16 Review ----
      h1('16. Monitoring, Review & Improvement'),
      p('This plan is reviewed at least annually, and also:'),
      bullet('After any notifiable event or significant incident.'),
      bullet('When tasks, vehicles, equipment, routes or sites change.'),
      bullet('When workers or WorkSafe identify a gap.'),
      p('Findings feed back into the risk register and procedures, closing the loop on continuous improvement.'),

      new Paragraph({ children: [new PageBreak()] }),

      // ---- Appendix A ----
      h1('Appendix A — Risk Rating Guide'),
      p('Combine how likely harm is with how serious it could be to get a risk level. Use it to prioritise controls — High risks need action before the task proceeds.'),
      table([2340, 2340, 2340, 2340], [
        new TableRow({ children: ratingMatrix[0].map((c, i) =>
          cell(c, { width: 2340, shade: i === 0 ? 'FFFFFF' : GREEN, bold: true, color: i === 0 ? '000000' : 'FFFFFF' })) }),
        ...ratingMatrix.slice(1).map(row => new TableRow({ children: row.map((c, i) => {
          if (i === 0) return cell(c, { width: 2340, shade: GREEN, bold: true, color: 'FFFFFF' });
          const shade = c === 'High' ? 'F8D7DA' : c === 'Medium' ? 'FFF3CD' : 'D4EDDA';
          return cell(c, { width: 2340, shade, bold: true });
        }) })),
      ]),
      spacer(80),
      bullet('High — stop and fix before continuing; strong controls and sign-off required.'),
      bullet('Medium — put controls in place and monitor; plan further improvement.'),
      bullet('Low — manage by routine procedures and good practice.'),

      // ---- Appendix B ----
      h1('Appendix B — Pre-Start Vehicle Checklist'),
      p('Complete before each run. Report any defect to the operations lead; do not drive an unsafe vehicle.'),
      table([6960, 2400], [
        headerRow(['Check', 'OK / Defect'], [6960, 2400]),
        ...vehicleChecks.map(c => new TableRow({ children: [
          cell(c, { width: 6960 }),
          cell('', { width: 2400 }),
        ]})),
      ]),
      spacer(80),
      p('Driver: ______________________   Vehicle/Rego: ______________   Date: ____________', { size: 20 }),

      // ---- Appendix C ----
      h1('Appendix C — Incident / Hazard Report'),
      p('Use for injuries, near-misses and hazards (in addition to an in-app report where available).'),
      table([3120, 6240], [
        new TableRow({ children: [cell('Date & time', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('Person(s) involved', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('Location / site', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('What happened', { width: 3120, shade: GREY, bold: true }), cell([new Paragraph(''), new Paragraph(''), new Paragraph('')], { width: 6240 })] }),
        new TableRow({ children: [cell('Injury / harm', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('Immediate action taken', { width: 3120, shade: GREY, bold: true }), cell([new Paragraph(''), new Paragraph('')], { width: 6240 })] }),
        new TableRow({ children: [cell('Notifiable to WorkSafe?', { width: 3120, shade: GREY, bold: true }), cell('Yes / No   (if yes, call 0800 030 040 & preserve the scene)', { width: 6240 })] }),
        new TableRow({ children: [cell('Reported to / by', { width: 3120, shade: GREY, bold: true }), cell('', { width: 6240 })] }),
        new TableRow({ children: [cell('Follow-up / controls added', { width: 3120, shade: GREY, bold: true }), cell([new Paragraph(''), new Paragraph('')], { width: 6240 })] }),
      ]),

      // ---- Appendix D ----
      h1('Appendix D — Worker Sign-Off'),
      p('I have read and understood this Health & Safety Plan, and I agree to follow the procedures and wear the required PPE.'),
      table([3120, 3120, 3120], [
        headerRow(['Name', 'Signature', 'Date'], [3120, 3120, 3120]),
        ...Array.from({ length: 6 }).map(() => new TableRow({ children: [
          cell('', { width: 3120 }), cell('', { width: 3120 }), cell('', { width: 3120 }),
        ]})),
      ]),
      spacer(160),
      new Paragraph({ children: [new TextRun({ text: 'End of plan.', italics: true, color: '888888' })] }),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const out = '../Green Loop Collections Health and Safety Plan.docx';
  fs.writeFileSync(out, buffer);
  console.log('Wrote', out, buffer.length, 'bytes');
});
