// Raw clinician notes used by both the unit tests and the live model evaluation.
// Cover OT and PT, home health and outpatient, dense and sparse documentation.
export const RAW_NOTES = [
  {
    id: 'ankle-sprain-balance',
    note_type: 'treatment',
    target_ehr: 'kinnser',
    raw_notes: 'Patient had slight left ankle sprain from kickboxing, did single leg balance with support 2 days after the injury, then continued to single leg without support, and then eyes closed as the final progression. Taught patient ankle alphabets, and recommended doing equal treatment on the other ankle as prehab.'
  },
  {
    id: 'hip-ub-dressing',
    note_type: 'treatment',
    target_ehr: 'kinnser',
    raw_notes: 'pt reports less R hip pain, doing HEP 2x/day. UB dressing min A. R hip flex 90 deg, abd 30 deg, IR 20 deg. MMT hip flex 3/5, abd 2/5. bed>chair SBA, amb 10 ft RW CGA.'
  },
  {
    id: 'stroke-initial-eval',
    note_type: 'initial-eval',
    target_ehr: 'therapyboss',
    raw_notes: '72yo L CVA, R hemiparesis. R shoulder flex AROM 0-85, PROM 0-140. R grip 3-/5. LB dressing mod A w/ reacher and sock aide, 12 min, 2 attempts, VC for sequencing. Toilet transfer CGA w/ grab bar. Skin intact.'
  },
  {
    id: 'sparse-note',
    note_type: 'treatment',
    target_ehr: 'kinnser',
    raw_notes: 'pt tired today, worked on sit to stand, needed help.'
  },
  {
    id: 'number-words',
    note_type: 'treatment',
    target_ehr: 'therapyboss',
    raw_notes: 'Pt completed three sets of ten sit to stands from standard chair with supervision. Reports pain four out of ten in L knee. Educated on energy conservation.'
  },
  {
    id: 'wound-skin',
    note_type: 'treatment',
    target_ehr: 'kinnser',
    raw_notes: 'Stage 2 pressure injury L heel noted, RN notified. Bed mobility mod A, rolling with bed rail. Instructed in heel offloading with pillow.'
  },
  {
    // The same digit means different things: 3/5 is a grade, 3x10 is sets x reps.
    id: 'mmt-and-exercise-counts',
    note_type: 'treatment',
    target_ehr: 'kinnser',
    raw_notes: 'R hip abd MMT 3/5, R knee ext 4-/5. sidelying hip abd 3x10, LAQ 2x15 R LE. pain 3/10 after ex.'
  },
  {
    // Times in hours and seconds that a model may rewrite in other units.
    id: 'time-and-frequency',
    note_type: 'treatment',
    target_ehr: 'therapyboss',
    raw_notes: 'tx 1 hour. NuStep 10 min level 3. SLS 30 sec x3 each LE with CGA. HEP BID, f/u 2 wks.'
  },
  {
    // Gait with distance, device, assist level, date and age.
    id: 'gait-distance-date',
    note_type: 'initial-eval',
    target_ehr: 'kinnser',
    raw_notes: 'DOS 9/12/2026. 81yo M s/p R TKA 9/1/2026. amb 150 ft RW SBA, 4 steps w/ 1 rail min A. R knee flex AROM 0-95 deg, ext lag 10 deg. pain 5/10 R knee.'
  }
];
