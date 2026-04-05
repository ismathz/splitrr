import React, { useEffect, useRef } from "react";
import autoAnimate from "@formkit/auto-animate";

interface Props {
	children: React.ReactNode;
	className?: string;
	style?: React.CSSProperties;
}

const AutoAnimateContainer = ({ children, className, style }: Props) => {
	const ref = useRef(null);

	useEffect(() => {
		ref.current && autoAnimate(ref.current);
	}, [ref]);

	return (
		<div ref={ref} className={className || ""} style={style || {}}>
			{children}
		</div>
	);
};

export default AutoAnimateContainer;
