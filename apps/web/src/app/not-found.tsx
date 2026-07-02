import { Button } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center text-center py-24">
      <p className="text-7xl font-extrabold text-teal-500">404</p>
      <p className="mt-4 text-lg text-white/60 max-w-md">
        This market does not exist or has been closed.
      </p>
      <Button href="/" className="mt-6">Back to home</Button>
    </div>
  );
}
