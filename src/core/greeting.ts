// The agent's first words, chosen by the time in Pune. The recording notice is required at the
// start of every call (brief §4.3). Indian callers commonly use the English time greetings even
// in Hindi or Marathi, so those stay in English.
export type Lang = 'en' | 'hi' | 'mr';

export function timeGreeting(now: Date): 'Good morning' | 'Good afternoon' | 'Good evening' | 'Hello' {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(now));
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17) return 'Good evening';
  return 'Hello'; // midnight to 5am
}

export function openingLine(lang: Lang, name: string | null, resuming: boolean, now = new Date()): string {
  const hi = timeGreeting(now);
  const who = name ? `${hi}, ${name}!` : `${hi}!`;
  if (resuming) {
    return {
      en: `${who} This is Ayaan from Aangan Studio again. It looks like we got cut off earlier. This call is recorded to help us serve you better. Shall we pick up where we left off?`,
      hi: `${who} मैं आंगन स्टूडियो से अयान फिर से बोल रहा हूँ। लगता है पिछली कॉल बीच में कट गई थी। बेहतर सेवा के लिए यह कॉल रिकॉर्ड की जा रही है। क्या हम वहीं से आगे बढ़ें?`,
      mr: `${who} मी आंगन स्टुडिओमधून अयान पुन्हा बोलतोय. मागचा कॉल मध्येच कट झाला असं दिसतंय. चांगली सेवा देण्यासाठी हा कॉल रेकॉर्ड केला जात आहे. आपण तिथूनच पुढे बोलूया का?`,
    }[lang];
  }
  return {
    en: `${who} This is Ayaan from Aangan Studio. This call is recorded to help us serve you better. How can I help you today?`,
    hi: `${who} मैं आंगन स्टूडियो से अयान बोल रहा हूँ। बेहतर सेवा के लिए यह कॉल रिकॉर्ड की जा रही है। बताइए, मैं आपकी कैसे मदद कर सकता हूँ?`,
    mr: `${who} मी आंगन स्टुडिओमधून अयान बोलतोय. चांगली सेवा देण्यासाठी हा कॉल रेकॉर्ड केला जात आहे. सांगा, मी आपली कशी मदत करू शकतो?`,
  }[lang];
}
