import { DESIGN_FACTS } from '@/crm/designFacts';
import { LoadingFact } from './loading-fact';

export default function Loading() {
  // A different fact each time, chosen on the server so it is there from the first paint.
  return <LoadingFact initial={Math.floor(Math.random() * DESIGN_FACTS.length)} />;
}
