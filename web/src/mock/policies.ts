import type { CriterionGroup, CriterionKind, DemoNote, PolicyListItem } from '@/api/types'

/** Mock-only criterion definition. Scoring finds `quotes` (met) or `unclearQuotes` (unclear) verbatim in the note. */
export interface CriterionDef {
  id: string
  text: string
  kind: CriterionKind
  group: CriterionGroup
  params: Record<string, unknown>
  question: string | null
  quotes: string[]
  unclearQuotes?: string[]
  /** Fact label template used when met from the note */
  factLabel: string
}

export interface PolicyDef extends PolicyListItem {
  criteria: CriterionDef[]
}

export const POLICIES: PolicyDef[] = [
  {
    insurer: 'Aetna',
    cpt: '72148',
    label: 'MRI lumbar spine without contrast',
    policy_id: 'CPB 0236',
    url: 'https://www.aetna.com/cpb/medical/data/200_299/0236.html',
    criteria_count: 5,
    pa_required: true,
    criteria: [
      {
        id: 'aetna-72148-c1',
        text: 'Failure of at least 6 weeks of conservative therapy (physical therapy, NSAIDs, or activity modification).',
        kind: 'conservative_therapy_duration',
        group: 'all_of',
        params: { min_weeks: 6 },
        question: 'How many weeks of conservative therapy has the patient completed, and what did it consist of?',
        quotes: ['completed 8 weeks of physical therapy', 'eight weeks of supervised physical therapy'],
        unclearQuotes: ['has tried some physical therapy'],
        factLabel: 'Conservative therapy duration',
      },
      {
        id: 'aetna-72148-c2',
        text: 'Low back pain with radicular symptoms persisting for 6 weeks or longer.',
        kind: 'symptom',
        group: 'all_of',
        params: { min_weeks: 6 },
        question: 'How long have the radicular symptoms been present?',
        quotes: ['radiating down the left leg to the foot for 10 weeks', 'radicular pain for 3 months'],
        factLabel: 'Radicular symptom duration',
      },
      {
        id: 'aetna-72148-c3',
        text: 'Objective neurologic deficit on examination (motor weakness, reflex change, or positive straight-leg raise).',
        kind: 'objective_finding',
        group: 'all_of',
        params: {},
        question:
          'Were there objective neurologic findings on exam, such as motor weakness, reflex changes, or a positive straight-leg raise?',
        quotes: ['Positive straight-leg raise at 40 degrees on the left', 'Diminished left Achilles reflex'],
        unclearQuotes: ['neuro exam grossly intact'],
        factLabel: 'Objective neurologic finding',
      },
      {
        id: 'aetna-72148-c4',
        text: 'The result of the MRI is expected to change management (e.g., surgical or injection referral).',
        kind: 'plan_of_care',
        group: 'all_of',
        params: {},
        question: 'Will the MRI result change management, for example a surgical or epidural injection referral?',
        quotes: ['MRI to evaluate for surgical referral', 'considering epidural steroid injection pending imaging'],
        factLabel: 'Plan of care',
      },
      {
        id: 'aetna-72148-c5',
        text: 'Red flag: cauda equina symptoms, progressive neurologic deficit, or suspected malignancy or infection.',
        kind: 'red_flag',
        group: 'red_flag_any_of',
        params: {},
        question: null,
        quotes: ['new urinary retention and saddle anesthesia', 'progressive foot drop'],
        factLabel: 'Red flag',
      },
    ],
  },
  {
    insurer: 'UnitedHealthcare',
    cpt: '70553',
    label: 'MRI brain with and without contrast',
    policy_id: 'UHC Radiology 2026-02',
    url: 'https://www.uhcprovider.com/en/policies-protocols/radiology-policies.html',
    criteria_count: 4,
    pa_required: true,
    criteria: [
      {
        id: 'uhc-70553-c1',
        text: 'New or worsening headache with atypical features (change in pattern, positional, or exertional).',
        kind: 'symptom',
        group: 'all_of',
        params: {},
        question: 'Has the headache pattern changed recently, and does it have positional or exertional features?',
        quotes: ['new-onset headaches over the past 3 weeks, worse when lying flat', 'change in headache pattern'],
        factLabel: 'Headache character',
      },
      {
        id: 'uhc-70553-c2',
        text: 'Abnormal finding on neurologic examination.',
        kind: 'objective_finding',
        group: 'any_of',
        params: {},
        question: 'Were there any abnormal findings on the neurologic exam?',
        quotes: ['right pronator drift', 'bilateral papilledema on fundoscopy'],
        unclearQuotes: ['exam limited by patient cooperation'],
        factLabel: 'Neurologic exam finding',
      },
      {
        id: 'uhc-70553-c3',
        text: 'Trial of at least 4 weeks of headache prophylaxis, unless red flags are present.',
        kind: 'conservative_therapy_duration',
        group: 'any_of',
        params: { min_weeks: 4 },
        question: 'Has the patient trialed at least 4 weeks of a prophylactic medication?',
        quotes: ['6 weeks of topiramate without relief'],
        factLabel: 'Prophylaxis trial',
      },
      {
        id: 'uhc-70553-c4',
        text: 'Red flag: thunderclap onset, papilledema, new seizure, or new focal neurologic deficit.',
        kind: 'red_flag',
        group: 'red_flag_any_of',
        params: {},
        question: null,
        quotes: ['thunderclap onset', 'bilateral papilledema on fundoscopy', 'first-ever seizure'],
        factLabel: 'Red flag',
      },
    ],
  },
  {
    insurer: 'Cigna',
    cpt: '27447',
    label: 'Total knee arthroplasty',
    policy_id: 'Cigna MCP 0526',
    url: 'https://static.cigna.com/assets/chcp/pdf/coveragePolicies/medical/mm_0526_coveragepositioncriteria_knee_arthroplasty.pdf',
    criteria_count: 4,
    pa_required: true,
    criteria: [
      {
        id: 'cigna-27447-c1',
        text: 'Radiographic evidence of advanced osteoarthritis (Kellgren-Lawrence grade 3 or 4).',
        kind: 'lab_or_imaging_done',
        group: 'all_of',
        params: { min_kl_grade: 3 },
        question: 'What Kellgren-Lawrence grade did the most recent weight-bearing radiographs show?',
        quotes: ['Kellgren-Lawrence grade 4 changes with bone-on-bone medial compartment'],
        factLabel: 'Radiographic OA grade',
      },
      {
        id: 'cigna-27447-c2',
        text: 'At least 12 weeks of non-operative treatment (physical therapy, NSAIDs, or intra-articular injection).',
        kind: 'conservative_therapy_duration',
        group: 'all_of',
        params: { min_weeks: 12 },
        question:
          'How many weeks of non-operative treatment has the patient completed, including physical therapy, NSAIDs, or injections?',
        quotes: ['16 weeks of physical therapy and two corticosteroid injections'],
        unclearQuotes: ['has been doing home exercises'],
        factLabel: 'Non-operative treatment duration',
      },
      {
        id: 'cigna-27447-c3',
        text: 'Body mass index below 40 kg/m².',
        kind: 'bmi_threshold',
        group: 'all_of',
        params: { max_bmi: 40 },
        question: 'What is the patient’s current BMI?',
        quotes: ['BMI 33.1', 'BMI 29.8'],
        factLabel: 'BMI',
      },
      {
        id: 'cigna-27447-c4',
        text: 'Pain and functional limitation interfering with activities of daily living.',
        kind: 'symptom',
        group: 'all_of',
        params: {},
        question: 'How does the knee pain limit daily activities?',
        quotes: ['unable to climb stairs or walk more than one block'],
        factLabel: 'Functional limitation',
      },
    ],
  },
  {
    insurer: 'Anthem',
    cpt: '43775',
    label: 'Laparoscopic sleeve gastrectomy',
    policy_id: 'Anthem CG-SURG-83',
    url: 'https://www.anthem.com/dam/medpolicies/abc/active/guidelines/gl_pw_a053636.html',
    criteria_count: 5,
    pa_required: true,
    criteria: [
      {
        id: 'anthem-43775-c1',
        text: 'BMI of 40 or greater, or 35 or greater with at least one obesity-related comorbidity.',
        kind: 'bmi_threshold',
        group: 'all_of',
        params: { min_bmi: 40, min_bmi_with_comorbidity: 35 },
        question: 'What is the patient’s current BMI?',
        quotes: ['BMI 42.6', 'BMI 37.4'],
        factLabel: 'BMI',
      },
      {
        id: 'anthem-43775-c2',
        text: 'Documented obesity-related comorbidity (type 2 diabetes, obstructive sleep apnea, or hypertension).',
        kind: 'comorbidity',
        group: 'all_of',
        params: {},
        question: 'Does the patient have a documented obesity-related comorbidity such as type 2 diabetes, sleep apnea, or hypertension?',
        quotes: ['type 2 diabetes on metformin', 'obstructive sleep apnea on CPAP'],
        factLabel: 'Comorbidity',
      },
      {
        id: 'anthem-43775-c3',
        text: 'Participation in a structured, physician-supervised weight-management program for at least 6 months.',
        kind: 'conservative_therapy_duration',
        group: 'all_of',
        params: { min_months: 6 },
        question: 'How many months has the patient participated in a supervised weight-management program?',
        quotes: ['completed a 6-month supervised weight-management program'],
        unclearQuotes: ['has attempted diet and exercise on her own'],
        factLabel: 'Supervised weight-management program',
      },
      {
        id: 'anthem-43775-c4',
        text: 'Pre-operative psychological evaluation completed.',
        kind: 'plan_of_care',
        group: 'all_of',
        params: {},
        question: 'Has a pre-operative psychological evaluation been completed, and on what date?',
        quotes: ['psychological evaluation completed on 09/14/2026 with clearance'],
        factLabel: 'Psychological evaluation',
      },
      {
        id: 'anthem-43775-c5',
        text: 'Patient is 18 years of age or older.',
        kind: 'age_threshold',
        group: 'all_of',
        params: { min_age: 18 },
        question: 'Please confirm the patient’s age.',
        quotes: ['44-year-old', '38-year-old'],
        factLabel: 'Age',
      },
    ],
  },
  {
    insurer: 'Aetna',
    cpt: '64483',
    label: 'Lumbar epidural steroid injection',
    policy_id: 'CPB 0016',
    url: 'https://www.aetna.com/cpb/medical/data/1_99/0016.html',
    criteria_count: 4,
    pa_required: true,
    criteria: [
      {
        id: 'aetna-64483-c1',
        text: 'Radicular pain present for at least 4 weeks.',
        kind: 'symptom',
        group: 'all_of',
        params: { min_weeks: 4 },
        question: 'How long has the radicular pain been present?',
        quotes: ['right L5 radicular pain for 7 weeks'],
        factLabel: 'Radicular pain duration',
      },
      {
        id: 'aetna-64483-c2',
        text: 'Advanced imaging (MRI or CT) correlating with the radicular findings.',
        kind: 'lab_or_imaging_done',
        group: 'all_of',
        params: {},
        question: 'Is there MRI or CT imaging that correlates with the radicular findings?',
        quotes: ['MRI 09/02/2026 shows a right paracentral L4-5 disc protrusion contacting the L5 nerve root'],
        factLabel: 'Correlating imaging',
      },
      {
        id: 'aetna-64483-c3',
        text: 'Failure of at least 4 weeks of conservative therapy.',
        kind: 'conservative_therapy_duration',
        group: 'all_of',
        params: { min_weeks: 4 },
        question: 'What conservative therapy has been tried, and for how long?',
        quotes: ['5 weeks of physical therapy and a course of naproxen without meaningful relief'],
        factLabel: 'Conservative therapy duration',
      },
      {
        id: 'aetna-64483-c4',
        text: 'Red flag: active infection, bleeding diathesis, or progressive neurologic deficit.',
        kind: 'red_flag',
        group: 'red_flag_any_of',
        params: {},
        question: null,
        quotes: ['progressive foot drop', 'febrile with elevated ESR'],
        factLabel: 'Red flag',
      },
    ],
  },
  {
    insurer: 'Humana',
    cpt: '95810',
    label: 'Attended polysomnography (sleep study)',
    policy_id: 'Humana MCP HUM-0413-010',
    url: 'https://mcp.humana.com/tad/tad_new/Search.aspx?policyType=both&searchType=Freetext&searchText=polysomnography',
    criteria_count: 3,
    pa_required: true,
    criteria: [
      {
        id: 'humana-95810-c1',
        text: 'Excessive daytime sleepiness (Epworth score of 10 or higher) or witnessed apneas.',
        kind: 'symptom',
        group: 'all_of',
        params: { min_epworth: 10 },
        question: 'What is the patient’s Epworth Sleepiness Scale score, or are there witnessed apneas?',
        quotes: ['Epworth Sleepiness Scale score of 14', 'wife reports witnessed apneas'],
        unclearQuotes: ['reports feeling tired during the day'],
        factLabel: 'Daytime sleepiness',
      },
      {
        id: 'humana-95810-c2',
        text: 'Supporting clinical finding: loud snoring, BMI of 30 or greater, neck circumference of 17 inches or greater, or hypertension.',
        kind: 'objective_finding',
        group: 'any_of',
        params: { min_bmi: 30 },
        question: 'Does the patient snore loudly, have a BMI of 30 or more, a neck circumference of 17 inches or more, or hypertension?',
        quotes: ['BMI 34.2', 'neck circumference 17.5 inches', 'loud habitual snoring'],
        factLabel: 'Supporting finding',
      },
      {
        id: 'humana-95810-c3',
        text: 'Patient is a candidate for treatment (e.g., CPAP) if obstructive sleep apnea is confirmed.',
        kind: 'plan_of_care',
        group: 'all_of',
        params: {},
        question: 'Is the patient willing and able to use CPAP if sleep apnea is confirmed?',
        quotes: ['willing to start CPAP if OSA is confirmed'],
        factLabel: 'Treatment candidacy',
      },
    ],
  },
]

export function findPolicy(cpt: string, insurer: string): PolicyDef | undefined {
  return POLICIES.find((p) => p.cpt === cpt && p.insurer.toLowerCase() === insurer.toLowerCase())
}

export const DEMO_NOTES: DemoNote[] = [
  {
    id: 'demo-1',
    label: 'Lumbar MRI, meets criteria',
    cpt: '72148',
    insurer: 'Aetna',
    expect: 'meets',
    patient: { name: 'Marcus Delgado', dob: '1979-03-22', member_id: 'W2210-4471', phone: '+14155550100' },
    physician: { name: 'Dr. Priya Natarajan', npi: '1932104567', phone: '+14155550177' },
    text: `CHIEF COMPLAINT: Low back pain radiating to the left leg.

HPI: 47-year-old male presents with low back pain radiating down the left leg to the foot for 10 weeks. Pain is 7/10, worse with sitting and forward flexion. Patient has completed 8 weeks of physical therapy (McKenzie protocol, twice weekly) plus scheduled naproxen 500 mg BID and activity modification without meaningful improvement. Denies bowel or bladder changes, saddle anesthesia, fever, weight loss, or history of malignancy.

EXAM: Positive straight-leg raise at 40 degrees on the left reproducing radicular symptoms. Diminished left Achilles reflex (1+ vs 2+ on the right). Strength 5/5 bilaterally. Sensation decreased over the lateral left foot.

ASSESSMENT: Left L5-S1 radiculopathy, failed conservative management.

PLAN: Order MRI lumbar spine without contrast (CPT 72148), MRI to evaluate for surgical referral versus epidural steroid injection. Continue home exercise program.`,
  },
  {
    id: 'demo-2',
    label: 'Brain MRI, red flag (expedite)',
    cpt: '70553',
    insurer: 'UnitedHealthcare',
    expect: 'red_flag',
    patient: { name: 'Elena Marsh', dob: '1991-11-05', member_id: 'UHC-88213-02', phone: '+14155550101' },
    physician: { name: 'Dr. Samuel Okafor', npi: '1871203984', phone: '+14155550178' },
    text: `CHIEF COMPLAINT: Severe headache.

HPI: 34-year-old female with new-onset headaches over the past 3 weeks, worse when lying flat and on waking. Three days ago she experienced a thunderclap onset headache reaching maximal intensity within one minute while exercising. Associated nausea and transient blurred vision. No prior headache history. No anticoagulant use.

EXAM: BP 148/92. Bilateral papilledema on fundoscopy. Subtle right pronator drift. Cranial nerves otherwise intact. No meningismus.

ASSESSMENT: Headache with red-flag features; concern for intracranial process, including venous sinus thrombosis.

PLAN: Urgent MRI brain with and without contrast (CPT 70553) with MR venography. Neurology notified. Patient instructed to go to the ED if symptoms worsen.`,
  },
  {
    id: 'demo-3',
    label: 'Knee replacement, PT duration gap',
    cpt: '27447',
    insurer: 'Cigna',
    expect: 'gap',
    patient: { name: 'Harold Kim', dob: '1957-06-14', member_id: 'CIG-5520-9931', phone: '+14155550102' },
    physician: { name: 'Dr. Lydia Fernandes', npi: '1356789012', phone: '+14155550179' },
    text: `CHIEF COMPLAINT: Right knee pain.

HPI: 69-year-old male with progressive right knee pain over 2 years. Pain is 8/10 with weight bearing; unable to climb stairs or walk more than one block. He has been doing home exercises and takes ibuprofen as needed. Reports one prior injection at an outside clinic, date unknown.

PMH: Hypertension, controlled. BMI 33.1.

EXAM: Antalgic gait. Right knee with varus alignment, moderate effusion, crepitus, flexion 0-105 degrees. Ligaments stable.

IMAGING: Weight-bearing radiographs 08/29/2026: Kellgren-Lawrence grade 4 changes with bone-on-bone medial compartment narrowing, subchondral sclerosis, and osteophytes.

ASSESSMENT: End-stage right knee osteoarthritis.

PLAN: Recommend right total knee arthroplasty (CPT 27447). Pre-operative clearance to follow.`,
  },
  {
    id: 'demo-4',
    label: 'Sleeve gastrectomy, psych eval gap',
    cpt: '43775',
    insurer: 'Anthem',
    expect: 'gap',
    patient: { name: 'Tamika Rowe', dob: '1982-01-30', member_id: 'ANT-77301-18', phone: '+14155550103' },
    physician: { name: 'Dr. Benjamin Alvarez', npi: '1649305871', phone: '+14155550180' },
    text: `CHIEF COMPLAINT: Bariatric surgery evaluation.

HPI: 44-year-old female referred for bariatric surgery. Weight 262 lb, height 65 in, BMI 42.6. Comorbidities include type 2 diabetes on metformin (A1c 7.9%) and hypertension on lisinopril. She has completed a 6-month supervised weight-management program through our clinic (03/2026-09/2026) with dietitian visits monthly, losing 9 lb. Non-smoker. No prior abdominal surgery.

EXAM: Obese, abdomen soft, no hernias.

ASSESSMENT: Class III obesity with T2DM and HTN; candidate for laparoscopic sleeve gastrectomy.

PLAN: Proceed with laparoscopic sleeve gastrectomy (CPT 43775). Nutrition and surgical education scheduled.`,
  },
  {
    id: 'demo-5',
    label: 'Epidural injection, meets criteria',
    cpt: '64483',
    insurer: 'Aetna',
    expect: 'meets',
    patient: { name: 'Jonathan Price', dob: '1968-09-09', member_id: 'W5581-2093', phone: '+14155550104' },
    physician: { name: 'Dr. Priya Natarajan', npi: '1932104567', phone: '+14155550177' },
    text: `CHIEF COMPLAINT: Right leg pain.

HPI: 58-year-old male with right L5 radicular pain for 7 weeks, 6/10, worse with prolonged standing. He has completed 5 weeks of physical therapy and a course of naproxen without meaningful relief. No bowel or bladder symptoms. No fever. Not on anticoagulants.

IMAGING: MRI 09/02/2026 shows a right paracentral L4-5 disc protrusion contacting the L5 nerve root, consistent with symptoms.

EXAM: Positive right straight-leg raise at 50 degrees. Strength 5/5. Reflexes symmetric.

ASSESSMENT: Right L5 radiculopathy secondary to L4-5 disc protrusion, failed conservative care.

PLAN: Right L4-5 transforaminal epidural steroid injection (CPT 64483) under fluoroscopy.`,
  },
  {
    id: 'demo-6',
    label: 'Sleep study, sleepiness unclear',
    cpt: '95810',
    insurer: 'Humana',
    expect: 'gap',
    patient: { name: 'Rosa Castellanos', dob: '1963-04-18', member_id: 'HUM-3390-7712', phone: '+14155550105' },
    physician: { name: 'Dr. Samuel Okafor', npi: '1871203984', phone: '+14155550178' },
    text: `CHIEF COMPLAINT: Snoring and fatigue.

HPI: 63-year-old female with loud habitual snoring reported by her husband for several years. She reports feeling tired during the day and occasionally nodding off while reading. Epworth score not yet administered. Hypertension on amlodipine. BMI 34.2, neck circumference 17.5 inches.

EXAM: Mallampati class III, crowded oropharynx.

ASSESSMENT: Suspected obstructive sleep apnea.

PLAN: Attended polysomnography (CPT 95810). Patient is willing to start CPAP if OSA is confirmed.`,
  },
]
