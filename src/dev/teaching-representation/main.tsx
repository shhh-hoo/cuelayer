import React from 'react';
import ReactDOM from 'react-dom/client';
const Review = React.lazy(() => new URLSearchParams(location.search).get('lesson') === 'trig' ? import('./TrigReview.tsx') : import('./Review.tsx'));
document.title = 'CueLayer · Teaching representation';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><React.Suspense fallback={null}><Review /></React.Suspense></React.StrictMode>);
