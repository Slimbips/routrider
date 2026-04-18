import { Suspense } from 'react';
import SharePageContent from './SharePageContent';

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <span className="text-gray-400">Route laden...</span>
        </div>
      }
    >
      <SharePageContent />
    </Suspense>
  );
}
