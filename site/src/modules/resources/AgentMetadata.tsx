import type { Interpolation, Theme } from "@emotion/react";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import { watchAgentMetadata } from "api/api";
import type {
	WorkspaceAgent,
	WorkspaceAgentMetadata,
} from "api/typesGenerated";
import { Stack } from "components/Stack/Stack";
import dayjs from "dayjs";
import {
	type FC,
	type HTMLAttributes,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { MONOSPACE_FONT_FAMILY } from "theme/constants";
import type { OneWayWebSocket } from "utils/OneWayWebSocket";

type ItemStatus = "stale" | "valid" | "loading";

export interface AgentMetadataViewProps {
	metadata: WorkspaceAgentMetadata[];
}

export const AgentMetadataView: FC<AgentMetadataViewProps> = ({ metadata }) => {
	if (metadata.length === 0) {
		return null;
	}
	return (
		<section css={styles.root}>
			{metadata.map((m) => (
				<MetadataItem key={m.description.key} item={m} />
			))}
		</section>
	);
};

interface AgentMetadataProps {
	agent: WorkspaceAgent;
	storybookMetadata?: WorkspaceAgentMetadata[];
}

export const AgentMetadata: FC<AgentMetadataProps> = ({
	agent,
	storybookMetadata,
}) => {
	const [metadata, setMetadata] = useState<
		WorkspaceAgentMetadata[] | undefined
	>(storybookMetadata);

	useEffect(() => {
		// Even though we're using storybookMetadata as the initial value of the
		// `metadata` state, we can't sync on `metadata` itself. If we did, the
		// moment we update the state with a new event, we would re-trigger the
		// effect and immediately destroy the connection
		if (storybookMetadata !== undefined) {
			return;
		}

		let timeoutId: number | undefined = undefined;
		let latestSocket: OneWayWebSocket | undefined = undefined;

		const createNewConnection = () => {
			const socket = watchAgentMetadata(agent.id);
			latestSocket = socket;

			socket.addEventListener("error", (e) => {
				console.error("received error in watch stream", e);
				setMetadata(undefined);
				socket.close();

				timeoutId = window.setTimeout(() => {
					createNewConnection();
				}, 3_000);
			});

			socket.addEventListener("message", (e) => {
				try {
					const data = JSON.parse(e.data);
					setMetadata(data);
				} catch (err) {}
			});
		};

		createNewConnection();
		return () => {
			window.clearTimeout(timeoutId);
			latestSocket?.close();
		};
	}, [agent.id, storybookMetadata]);

	if (metadata === undefined) {
		return (
			<section css={styles.root}>
				<AgentMetadataSkeleton />
			</section>
		);
	}

	return <AgentMetadataView metadata={metadata} />;
};

export const AgentMetadataSkeleton: FC = () => {
	return (
		<Stack alignItems="baseline" direction="row" spacing={6}>
			<div css={styles.metadata}>
				<Skeleton width={40} height={12} variant="text" />
				<Skeleton width={65} height={14} variant="text" />
			</div>

			<div css={styles.metadata}>
				<Skeleton width={40} height={12} variant="text" />
				<Skeleton width={65} height={14} variant="text" />
			</div>

			<div css={styles.metadata}>
				<Skeleton width={40} height={12} variant="text" />
				<Skeleton width={65} height={14} variant="text" />
			</div>
		</Stack>
	);
};

interface MetadataItemProps {
	item: WorkspaceAgentMetadata;
}

const MetadataItem: FC<MetadataItemProps> = ({ item }) => {
	const staleThreshold = Math.max(
		item.description.interval + item.description.timeout * 2,
		// In case there is intense backpressure, we give a little bit of slack.
		5,
	);

	const status: ItemStatus = (() => {
		const year = dayjs(item.result.collected_at).year();
		if (year <= 1970 || Number.isNaN(year)) {
			return "loading";
		}
		// There is a special circumstance for metadata with `interval: 0`. It is
		// expected that they run once and never again, so never display them as
		// stale.
		if (item.result.age > staleThreshold && item.description.interval > 0) {
			return "stale";
		}
		return "valid";
	})();

	// Stale data is as good as no data. Plus, we want to build confidence in our
	// users that what's shown is real. If times aren't correctly synced this
	// could be buggy. But, how common is that anyways?
	const value =
		status === "loading" ? (
			<Skeleton width={65} height={12} variant="text" css={styles.skeleton} />
		) : status === "stale" ? (
			<Tooltip title="This data is stale and no longer up to date">
				<StaticWidth css={[styles.metadataValue, styles.metadataStale]}>
					{item.result.value}
				</StaticWidth>
			</Tooltip>
		) : (
			<StaticWidth
				css={[
					styles.metadataValue,
					item.result.error.length === 0
						? styles.metadataValueSuccess
						: styles.metadataValueError,
				]}
			>
				{item.result.value}
			</StaticWidth>
		);

	return (
		<div css={styles.metadata}>
			<div css={styles.metadataLabel}>{item.description.display_name}</div>
			<div>{value}</div>
		</div>
	);
};

const StaticWidth: FC<HTMLAttributes<HTMLDivElement>> = ({
	children,
	...attrs
}) => {
	const ref = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: consider refactoring
	useLayoutEffect(() => {
		// Ignore this in storybook
		if (!ref.current || process.env.STORYBOOK === "true") {
			return;
		}

		const currentWidth = ref.current.getBoundingClientRect().width;
		ref.current.style.width = "auto";
		const autoWidth = ref.current.getBoundingClientRect().width;
		ref.current.style.width =
			autoWidth > currentWidth ? `${autoWidth}px` : `${currentWidth}px`;
	}, [children]);

	return (
		<div ref={ref} {...attrs}>
			{children}
		</div>
	);
};

// These are more or less copied from
// site/src/modules/resources/ResourceCard.tsx
const styles = {
	root: {
		display: "flex",
		alignItems: "baseline",
		flexWrap: "wrap",
		gap: 32,
		rowGap: 16,
	},

	metadata: {
		lineHeight: "1.6",
		display: "flex",
		flexDirection: "column",
		overflow: "visible",
		flexShrink: 0,
	},

	metadataLabel: (theme) => ({
		color: theme.palette.text.secondary,
		textOverflow: "ellipsis",
		overflow: "hidden",
		whiteSpace: "nowrap",
		fontSize: 13,
	}),

	metadataValue: {
		textOverflow: "ellipsis",
		overflow: "hidden",
		whiteSpace: "nowrap",
		maxWidth: "16em",
		fontSize: 14,
	},

	metadataValueSuccess: (theme) => ({
		color: theme.roles.success.fill.outline,
	}),

	metadataValueError: (theme) => ({
		color: theme.palette.error.main,
	}),

	metadataStale: (theme) => ({
		color: theme.palette.text.disabled,
		cursor: "pointer",
	}),

	skeleton: {
		marginTop: 4,
	},

	inlineCommand: (theme) => ({
		fontFamily: MONOSPACE_FONT_FAMILY,
		display: "inline-block",
		fontWeight: 600,
		margin: 0,
		borderRadius: 4,
		color: theme.palette.text.primary,
	}),
} satisfies Record<string, Interpolation<Theme>>;
