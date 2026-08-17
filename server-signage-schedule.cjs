const TIMEZONE = 'Europe/Brussels';

function zonedParts(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    dayOfWeek: weekdayMap[parts.weekday],
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    timeKey: `${parts.hour}:${parts.minute}:${parts.second}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function easterSundayUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function dateKeyUtc(date) {
  return date.toISOString().slice(0, 10);
}

function belgianHolidayName(dateKey) {
  const year = Number(dateKey.slice(0, 4));
  const fixed = new Map([
    [`${year}-01-01`, 'Nouvel An'],
    [`${year}-05-01`, 'Fête du Travail'],
    [`${year}-07-21`, 'Fête nationale'],
    [`${year}-08-15`, 'Assomption'],
    [`${year}-11-01`, 'Toussaint'],
    [`${year}-11-11`, 'Armistice'],
    [`${year}-12-25`, 'Noël']
  ]);
  if (fixed.has(dateKey)) return fixed.get(dateKey);
  const easter = easterSundayUtc(year);
  const movable = new Map([
    [dateKeyUtc(addUtcDays(easter, 1)), 'Lundi de Pâques'],
    [dateKeyUtc(addUtcDays(easter, 39)), 'Ascension'],
    [dateKeyUtc(addUtcDays(easter, 50)), 'Lundi de Pentecôte']
  ]);
  return movable.get(dateKey) || null;
}

function parseHm(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function inRanges(minutes, ranges) {
  return (ranges || []).some(range => {
    const start = parseHm(range.start_time ?? range.startTime);
    const end = parseHm(range.end_time ?? range.endTime);
    return start !== null && end !== null && start < end && minutes >= start && minutes < end;
  });
}

function nextBoundaryMinutes(minutes, ranges) {
  const values = [];
  for (const range of ranges || []) {
    const start = parseHm(range.start_time ?? range.startTime);
    const end = parseHm(range.end_time ?? range.endTime);
    if (start !== null && start > minutes) values.push(start);
    if (end !== null && end > minutes) values.push(end);
  }
  return values.length ? Math.min(...values) : null;
}

function nextChangeIso(now, targetMinutes) {
  if (targetMinutes === null || targetMinutes === undefined) return null;
  const p = zonedParts(now);
  const delta = Math.max(1, targetMinutes - p.minutes);
  return new Date(new Date(now).getTime() + delta * 60000).toISOString();
}

async function evaluatePlayerAdSchedule({ db, playerId, ownerEmail, now = new Date() }) {
  const email = encodeURIComponent(String(ownerEmail || '').toLowerCase());
  const pid = encodeURIComponent(String(playerId || ''));
  const settingsRows = await db(`signage_player_schedule_settings?select=*&player_id=eq.${pid}&owner_email=eq.${email}&limit=1`);
  const settings = settingsRows?.[0];
  if (!settings || settings.configured !== true) {
    return { adsAllowed: true, reason: 'legacy_unconfigured', nextChangeAt: null };
  }

  const local = zonedParts(now);
  const exceptionRows = await db(`signage_player_schedule_exceptions?select=*&player_id=eq.${pid}&owner_email=eq.${email}&exception_date=eq.${encodeURIComponent(local.dateKey)}&limit=1`);
  const exception = exceptionRows?.[0];
  if (exception) {
    if (exception.mode === 'closed') return { adsAllowed: false, reason: 'date_exception_closed', nextChangeAt: null };
    if (exception.mode === 'special_hours') {
      const ranges = Array.isArray(exception.ranges) ? exception.ranges : [];
      return {
        adsAllowed: inRanges(local.minutes, ranges),
        reason: inRanges(local.minutes, ranges) ? 'date_exception_special_hours' : 'outside_date_exception_hours',
        nextChangeAt: nextChangeIso(now, nextBoundaryMinutes(local.minutes, ranges))
      };
    }
    // mode normal explicitly bypasses the public-holiday block and falls through to weekly schedule.
  } else if (settings.block_belgian_holidays !== false) {
    const holiday = belgianHolidayName(local.dateKey);
    if (holiday) return { adsAllowed: false, reason: `belgian_holiday:${holiday}`, nextChangeAt: null };
  }

  const ranges = await db(`signage_player_schedule_ranges?select=*&player_id=eq.${pid}&owner_email=eq.${email}&day_of_week=eq.${local.dayOfWeek}&order=start_time.asc`);
  const allowed = inRanges(local.minutes, ranges || []);
  return {
    adsAllowed: allowed,
    reason: allowed ? 'weekly_schedule' : 'outside_weekly_schedule',
    nextChangeAt: nextChangeIso(now, nextBoundaryMinutes(local.minutes, ranges || []))
  };
}

module.exports = {
  TIMEZONE,
  zonedParts,
  easterSundayUtc,
  belgianHolidayName,
  inRanges,
  evaluatePlayerAdSchedule
};
