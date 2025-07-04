import React, { createContext, useEffect, useRef, useState } from "react";
import { Event } from "nostr-tools";
import { defaultRelays } from "../nostr";
import { useAppContext } from "../hooks/useAppContext";
import { useUserContext } from "../hooks/useUserContext";

type RatingMap = Map<string, Map<string, number>>; // entityId -> pubkey -> rating

interface RatingContextType {
  registerEntityId: (id: string) => void;
  getAverageRating: (id: string) => { avg: number; count: number } | null;
  ratings: RatingMap;
  userRatingEvent?: Event
}

export const RatingContext = createContext<RatingContextType>({
  registerEntityId: (id: string) => null,
  getAverageRating: (id: String) => {
    return { avg: -1, count: -1 };
  },
  ratings: new Map(),
});

export const RatingProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { poolRef } = useAppContext();
  const [ratings, setRatings] = useState<RatingMap>(new Map());
  const [userRatingEvent, setUserRatingEvent]= useState<Event>()
  const trackedIdsRef = useRef<Set<string>>(new Set());
  const lastTrackedIds = useRef<string[]>([]);
  const subscriptionRef = useRef<ReturnType<
    typeof poolRef.current.subscribeMany
  > | null>(null);

  const { user } = useUserContext();

  const registerEntityId = (id: string) => {
    trackedIdsRef.current.add(id);
  };

  const getAverageRating = (entityId: string) => {
    const entityRatings = ratings.get(entityId);
    if (!entityRatings) return null;

    const values = Array.from(entityRatings.values());
    const avg = values.reduce((sum, r) => sum + r, 0) / values.length;
    return { avg, count: values.length };
  };

  const handleEvent = (ev: Event) => {
    const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
    const ratingTag = ev.tags.find((t) => t[0] === "rating")?.[1];
    const pubkey = ev.pubkey;
    if(user && user.pubkey === ev.pubkey) {
      if(userRatingEvent && userRatingEvent.created_at > ev.created_at) return
      setUserRatingEvent(ev as Event)
    }

    if (!dTag || !ratingTag || !pubkey) return;
    const value = parseFloat(ratingTag);
    if (isNaN(value) || value < 0 || value > 1) return;

    setRatings((prev) => {
      const next = new Map(prev);
      const entityMap = new Map(next.get(dTag) || []);
      entityMap.set(pubkey, value);
      next.set(dTag, entityMap);
      return next;
    });
  };

  useEffect(() => {
    if (!poolRef) return;
    const interval = setInterval(() => {
      const ids = Array.from(trackedIdsRef.current);
      const hasChanged =
        ids.length !== lastTrackedIds.current.length ||
        ids.some((id, i) => id !== lastTrackedIds.current[i]);
      if (!hasChanged) return;
      lastTrackedIds.current = ids;

      if (subscriptionRef.current) {
        subscriptionRef.current.close();
      }

      if (ids.length === 0) return;

      const filters = [
        {
          kinds: [34259],
          "#d": ids,
        },
      ];

      subscriptionRef.current = poolRef.current.subscribeMany(
        defaultRelays,
        filters,
        {
          onevent: handleEvent,
        }
      );
    }, 3000); // Adjust frequency as needed

    return () => {
      clearInterval(interval);
      if (subscriptionRef.current) subscriptionRef.current.close();
    };
  }, [poolRef, user]);

  return (
    <RatingContext.Provider
      value={{ registerEntityId, getAverageRating, ratings, userRatingEvent }}
    >
      {children}
    </RatingContext.Provider>
  );
};
