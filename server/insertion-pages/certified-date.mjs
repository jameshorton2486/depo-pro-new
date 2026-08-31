const MONTHS = Object.freeze(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);

// Canonical dates stay ISO for sorting and comparison. Certified pages receive one deterministic
// English projection without invoking the host locale or timezone. Legacy free-text values remain
// visible rather than being guessed into a different date.
export function certifiedDate(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return text;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day) return text;
  return `${MONTHS[month-1]} ${day}, ${year}`;
}

export function certifiedDateValues(values) {
  const next={...values};
  for(const key of ["deposition.date","cert.submissionDate","cert.returnDeadline","cert.returnStatus","cert.serviceDate","cert.certificationDate","cert.furtherCertificationDate","reporter.csrExpirationDate"]){
    if(next[key]!=null)next[key]=certifiedDate(next[key]);
  }
  return next;
}
