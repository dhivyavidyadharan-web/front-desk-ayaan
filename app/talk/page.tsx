import { vaaniConfigFromEnv } from '@/channels/voice/providers/vaani';
import { TalkCall } from './call';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Talk to Aangan Studio' };

export default function TalkPage() {
  if (!vaaniConfigFromEnv()) {
    return (
      <main className="talk">
        <div className="card talk-live">
          <h1>Talk to Aangan Studio</h1>
          <p className="sub">Our voice assistant is being set up. Please check back shortly.</p>
        </div>
      </main>
    );
  }
  return (
    <main>
      <TalkCall />
    </main>
  );
}
