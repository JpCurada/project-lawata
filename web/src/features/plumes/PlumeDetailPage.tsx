import { Link, useParams } from "react-router-dom";
import { SignInCard, useAuth } from "../../shared/auth";
import { BlockError, BlockLoading } from "../../shared/ui/BlockState";
import { Skeleton, SkeletonLines } from "../../shared/ui/Skeleton";
import { NotFoundError, usePlumeQuery } from "./api";
import { AgentDecisionCard, EvidenceImage, PlaceHistory, PlumeHeader, RainCard } from "./PlumeSections";
import { ReviewSection } from "./ReviewSection";
import "./plumes.css";

function parseId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function PlumeDetailSkeleton() {
  return (
    <div className="plume-detail">
      <div className="plume-header">
        <Skeleton width="8rem" />
        <Skeleton shape="block" width="60%" height="3rem" className="plume-skeleton__title" />
        <Skeleton width="40%" />
      </div>
      <div className="plume-detail__grid">
        <div className="card plume-detail__main">
          <Skeleton width="40%" height="1.25rem" />
          <Skeleton shape="block" width="100%" aspectRatio="16 / 9" className="plume-skeleton__gap" />
        </div>
        <div className="card plume-detail__side">
          <Skeleton width="55%" height="1.25rem" />
          <div className="rain plume-skeleton__gap">
            <Skeleton shape="block" height="3rem" />
            <Skeleton shape="block" height="3rem" />
          </div>
          <SkeletonLines count={2} />
        </div>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <section className="page">
      <h1 className="page__title">Plume not found</h1>
      <p className="page__lead">There is no plume with this id. It may have been removed, or the link is mistyped.</p>
      <Link to="/explore">Back to the map</Link>
    </section>
  );
}

export function PlumeDetailPage() {
  const { plumeId } = useParams();
  const id = parseId(plumeId);
  return id === null ? <NotFound /> : <PlumeDetail key={id} id={id} />;
}

/** Public viewers get one calm card in place of the agent decision and the reviews. */
function ResearcherSectionsLocked() {
  return (
    <section className="plume-detail__locked" aria-label="Agent assessment and reviews">
      <SignInCard title="Sign in to see the agent's assessment and reviews">
        Researchers can see what the agent decided for this plume, read reviews and add their own.
      </SignInCard>
    </section>
  );
}

function PlumeDetail({ id }: { id: number }) {
  const auth = useAuth();
  // Wait for the stored session so the first request already carries the token (no public flash).
  const plume = usePlumeQuery(id, { enabled: auth.status !== "loading" });

  if (plume.isPending) {
    return (
      <section className="page">
        <h1 className="visually-hidden">Plume {id}</h1>
        <BlockLoading skeleton={<PlumeDetailSkeleton />}>Loading plume...</BlockLoading>
      </section>
    );
  }
  if (plume.isError) {
    if (plume.error instanceof NotFoundError) return <NotFound />;
    return (
      <section className="page">
        <h1 className="page__title">Plume {id}</h1>
        <BlockError onRetry={() => void plume.refetch()}>Can't load this plume right now.</BlockError>
      </section>
    );
  }

  const data = plume.data;
  return (
    <article className="page plume-detail">
      <PlumeHeader plume={data} />
      <div className="plume-detail__grid">
        <div className="plume-detail__main">
          <EvidenceImage plume={data} />
        </div>
        <div className="plume-detail__side">
          <RainCard plume={data} />
          <PlaceHistory plume={data} />
          {data.viewer === "researcher" ? (
            <>
              <AgentDecisionCard plume={data} />
              <ReviewSection plumeId={data.id} />
            </>
          ) : (
            <ResearcherSectionsLocked />
          )}
        </div>
      </div>
    </article>
  );
}
