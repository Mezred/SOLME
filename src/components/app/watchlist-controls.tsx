"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/client";

export function FavoriteToggle({ itemId, favorite }: { itemId: string; favorite: boolean }) {
  const router = useRouter();
  return (
    <button
      className={favorite ? "text-warn" : "text-fg-faint hover:text-warn"}
      aria-label={favorite ? "Unmark favorite" : "Mark favorite"}
      aria-pressed={favorite}
      onClick={async () => {
        await apiFetch("/api/watchlists/items", { method: "PATCH", body: { itemId, isFavorite: !favorite } });
        router.refresh();
      }}
    >
      {favorite ? "★" : "☆"}
    </button>
  );
}

export function RemoveItem({ itemId }: { itemId: string }) {
  const router = useRouter();
  return (
    <button
      className="text-xs text-fg-faint hover:text-down"
      onClick={async () => {
        await apiFetch(`/api/watchlists/items?itemId=${itemId}`, { method: "DELETE" });
        router.refresh();
      }}
    >
      Remove
    </button>
  );
}

export function NewWatchlist() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await apiFetch("/api/watchlists", { body: { name } });
    if (!r.ok) return setError(r.error);
    setName("");
    setError(null);
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New watchlist name" className="input h-8 w-48 text-sm" aria-label="New watchlist name" maxLength={60} required />
      <Button size="sm" type="submit">Create</Button>
      {error && <span className="text-xs text-down">{error}</span>}
    </form>
  );
}

export function DeleteWatchlist({ id }: { id: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirm) return <button className="text-xs text-fg-faint hover:text-down" onClick={() => setConfirm(true)}>Delete list</button>;
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-fg-muted">Delete this list?</span>
      <button
        className="text-down"
        onClick={async () => {
          const r = await apiFetch(`/api/watchlists/${id}`, { method: "DELETE" });
          if (!r.ok) return setError(r.error);
          router.refresh();
        }}
      >
        Yes, delete
      </button>
      <button className="text-fg-faint" onClick={() => setConfirm(false)}>Cancel</button>
      {error && <span className="text-down">{error}</span>}
    </span>
  );
}
