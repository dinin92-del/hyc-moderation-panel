This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Kontrakt z backendem

Panel czyta Firestore klientem, a zapisuje wyłącznie przez callable w regionie `europe-central2`. Punkt z bazy zwykle nie ma dokumentu `points/{id}`, więc jego dane przychodzą z callable, nie z Firestore.

- `moderatorSearchPoints`: wyszukiwarka zakładki Punkty po całej bazie. Tekst, id, telefon, autor albo `near`, do tego `type` i `view` (`all`, `suppressed`, `ugc`, `edited`).
- `moderatorLookupPoints`: nazwa i typ punktu z bazy po CID. Panel łączy zapytania w paczkę.
- `onModeratorEditPoint`: edycja także punktu bez dokumentu, zakłada nakładkę. Pozycji punktu z bazy nie zmienia.
- `onModeratorDeletePoint` i `onModeratorRestorePoint`: punkt z bazy dostaje tombstone w `suppressedPoints/{cid}` i da się go przywrócić, przywrócenie wymaga powodu (min. 25 znaków). Punkt UGC znika na stałe.
- `onModeratorDecision` z akcją `closeReportsForTarget`: zamyka wszystkie zgłoszenia celu. Zamknięcie zgłoszenia wysyła zgłaszającemu mail z decyzją (trigger `onReportResolved`).

Kartę punktu otwiera parametr `?punkt=<id>` w adresie, więc link do punktu można przekazać innemu moderatorowi. Deploy: najpierw funkcje, potem panel, bo panel woła nowe callable.
