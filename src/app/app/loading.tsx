import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-96 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <div className="card mt-4 space-y-2 p-4">
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8" />)}
      </div>
    </div>
  );
}
