# APEX P1 Eligibility Calculator

ACT Learner Driver eligibility calculator for P1 provisional licence in Australia.

## Features

- **Eligibility Calculator** - Calculate hours, tenure, and requirements for P1
- **Logbook Scanner** - Upload logbook photos, AI extracts hours automatically
- **Role-based Access** - Student, Instructor, Admin views
- **Government Booking Links** - Direct links to Access Canberra

## Files

| File | Description |
|------|-------------|
| `app.html` | Main application (production-ready) |
| `logbook-scanner.html` | AI-powered logbook page scanner |
| `supabase-schema.sql` | Database schema for Supabase |
| `SETUP.md` | Setup instructions |

## Tech Stack

- **Auth**: Clerk
- **Database**: Supabase
- **AI**: Claude API (for logbook scanning)
- **Frontend**: Vanilla JS + Tailwind CSS

## Quick Start

1. Create accounts at [Clerk](https://clerk.com) and [Supabase](https://supabase.com)
2. Update credentials in `app.html`
3. Run `supabase-schema.sql` in Supabase SQL Editor
4. Deploy to any static hosting (Vercel, Netlify, etc.)

## Calculator Logic

### Under 25 (P1 Red Pathway)
- 100 total hours required
- 10 night hours minimum
- 12 months learner tenure

### 25+ (P2 Green Pathway)
- 50 total hours required
- 5 night hours minimum
- 6 months learner tenure

### Credits
- Professional instructor: 3-for-1 (max 10 actual = 30 credit)
- Safer Driver Course: +20 hours
- VRU Awareness: +10 hours
- First Aid: +5 hours

### Mandatory Assessments
- HPT (Hazard Perception Test) with certificate number
- CBT&A (Competency Based Training)
- Assessment 1-22

## License

MIT
