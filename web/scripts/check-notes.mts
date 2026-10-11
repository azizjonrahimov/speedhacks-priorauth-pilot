import { DEMO_NOTES, findPolicy } from '../src/mock/policies.ts'
for (const n of DEMO_NOTES) {
  const p = findPolicy(n.cpt, n.insurer)!
  const rows = p.criteria.map(d => {
    const q = d.quotes.find(q => n.text.includes(q)); const u = d.unclearQuotes?.find(q => n.text.includes(q))
    return `${d.id}: ${q ? 'MET' : u ? 'UNCLEAR' : d.group==='red_flag_any_of' ? 'n/a' : 'MISSING'}`
  })
  console.log(`${n.id} (${n.expect}):`, rows.join(' | '))
}
