'use client';
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { finishWebCall, startWebCall } from './actions';

type Phase = 'form' | 'connecting' | 'live' | 'ended';

export function TalkCall() {
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const callIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => void roomRef.current?.disconnect(), []);

  async function start(form: FormData) {
    setError(null);
    setPhase('connecting');
    const r = await startWebCall({
      name: String(form.get('name') ?? ''),
      phone: String(form.get('phone') ?? ''),
      language: String(form.get('language') ?? 'en'),
      consent: form.get('consent') === 'on',
    });
    if (!r.ok) {
      setError(r.error);
      setPhase('form');
      return;
    }
    callIdRef.current = r.callId;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) audioRef.current?.appendChild(track.attach());
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) =>
      setAgentSpeaking(speakers.some((s) => s.identity !== room.localParticipant.identity)),
    );
    room.on(RoomEvent.Disconnected, () => {
      setPhase('ended');
      setAgentSpeaking(false);
      if (audioRef.current) audioRef.current.innerHTML = '';
      void collect(callIdRef.current);
    });
    try {
      await room.connect(r.url, r.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.startAudio();
      setMuted(false);
      setPhase('live');
    } catch (err) {
      await room.disconnect();
      roomRef.current = null;
      const denied = err instanceof Error && /permission|NotAllowed/i.test(`${err.name} ${err.message}`);
      setError(denied ? 'Please allow microphone access so we can hear you, then try again.' : 'We couldn’t connect the call. Please try again.');
      setPhase('form');
    }
  }

  // After hang-up, ask the server to fetch the transcript from Vaani (it can take a minute to
  // be ready). The daily job picks up anything still missing if the page is closed early.
  async function collect(callId: string | null) {
    if (!callId) return;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 8000 : 15000));
      const status = await finishWebCall(callId).catch(() => 'pending' as const);
      if (status !== 'pending') return;
    }
  }

  async function toggleMute() {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(muted);
    setMuted(!muted);
  }

  return (
    <div className="talk">
      <div className={`pendant ${agentSpeaking ? 'speaking' : ''} ${phase === 'live' ? 'on' : ''}`} aria-hidden="true">
        <span className="cord" />
        <span className="shade" />
        <span className="bulb" />
        <span className="pool" />
      </div>
      <div ref={audioRef} hidden />

      {phase === 'form' || phase === 'connecting' ? (
        <form
          className="card talk-form"
          onSubmit={(e) => {
            // Not a form action: React resets the fields after one, and callers shouldn't retype on an error.
            e.preventDefault();
            void start(new FormData(e.currentTarget));
          }}
        >
          <h1>Talk to Aangan Studio</h1>
          <p className="sub">Our assistant answers any time, day or night, and gets your details straight to a designer.</p>
          {error ? <div className="flash error" role="alert">{error}</div> : null}
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" required maxLength={60} autoComplete="name" />
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" required inputMode="tel" autoComplete="tel" placeholder="98xxxxxxxx" />
          <label htmlFor="language">Language</label>
          <select id="language" name="language" defaultValue="en">
            <option value="en">English</option>
            <option value="hi">हिन्दी (Hindi)</option>
            <option value="mr">मराठी (Marathi)</option>
          </select>
          <label className="consent">
            <input type="checkbox" name="consent" required /> I understand this call is recorded and transcribed so the studio can follow up.
          </label>
          <button type="submit" className="primary" disabled={phase === 'connecting'}>
            {phase === 'connecting' ? 'Connecting…' : 'Start call'}
          </button>
          <p className="sub small">You’ll need to allow microphone access.</p>
        </form>
      ) : null}

      {phase === 'live' ? (
        <div className="card talk-live" role="status" aria-live="polite">
          <h1>{agentSpeaking ? 'Aangan is speaking…' : 'Listening…'}</h1>
          <p className="sub">Speak naturally. You can switch between English, Hindi and Marathi.</p>
          <div className="form-row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button type="button" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
            <button type="button" className="primary" onClick={() => roomRef.current?.disconnect()}>End call</button>
          </div>
        </div>
      ) : null}

      {phase === 'ended' ? (
        <div className="card talk-live" role="status">
          <h1>Thank you for calling</h1>
          <p className="sub">The studio has your details. If a consultation was booked, the invite is on its way to your email.</p>
          <div className="form-row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button type="button" onClick={() => setPhase('form')}>Call again</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
