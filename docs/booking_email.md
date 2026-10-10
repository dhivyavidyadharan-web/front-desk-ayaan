# Consultation confirmation email

cal.com sends this to the client when the agent books a consultation. Paste it into the consultation event type in cal.com: **Workflows → New workflow → "When new event is booked" → Send email to attendee**. The `{PLACEHOLDERS}` are cal.com workflow variables; check the variable list in the cal.com editor if any name differs.

No prices, no designer promises, no timelines, matching the rules the agent follows.

---

**Subject:** Your Aangan Studio consultation, {EVENT_DATE_ddd, MMM D} at {EVENT_TIME_h:mma}

Hi {ATTENDEE_FIRST_NAME},

Thank you for calling Aangan Studio. Your consultation is confirmed.

**When:** {EVENT_DATE_dddd, MMMM D, YYYY} at {EVENT_TIME_h:mma} ({TIMEZONE})
**Where:** {LOCATION}
{MEETING_URL}

Your designer has the details you shared on the call, so you won't need to repeat yourself. Feel free to bring photos, a floor plan, or pictures of spaces you love.

Need a different time? Reschedule here: {RESCHEDULE_URL}
Can't make it? Cancel here: {CANCEL_URL}

See you soon,
Aangan Studio

---

### Location settings in cal.com

- **Online:** Cal Video. `{MEETING_URL}` becomes the video link.
- **At the studio:** "In person (organizer address)" with the studio's full address. `{LOCATION}` then shows the address, which is why the agent only says "You'll get the address in the email."

### Testing

During testing, give **dhivyaezhava123@gmail.com** as the email on the call, so every confirmation lands in one inbox.
