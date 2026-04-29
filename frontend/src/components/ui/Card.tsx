import { HTMLAttributes } from "react";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg border border-zinc-800 bg-zinc-900 shadow-sm ${className}`} {...rest} />;
}

export function CardHeader({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-4 border-b border-zinc-800 ${className}`} {...rest} />;
}

export function CardBody({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-4 ${className}`} {...rest} />;
}
