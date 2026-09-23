export function chicagoDate(value:string|null|undefined){if(!value)return 'Not supplied';if(/^\d{4}-\d{2}-\d{2}$/.test(value))return new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'America/Chicago'});const d=new Date(value);return Number.isNaN(d.getTime())?'Not supplied':d.toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'});}

export function chicagoDay(value:string|null|undefined) {
  if(!value)return 'Not supplied';
  const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00Z':value);
  return Number.isNaN(date.getTime())?'Not supplied':date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Chicago'});
}
