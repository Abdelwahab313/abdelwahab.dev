import React, {createContext, useContext} from "react";
import {AbsoluteFill} from "remotion";
import {loadFont} from "@remotion/google-fonts/IBMPlexMono";

const {fontFamily} = loadFont("normal", {weights: ["400", "500"], subsets: ["latin"]});

// Same tokens as src/styles/global.css; a video cannot read CSS variables.
export const THEMES = {
  dark: {
    bg: "#0e1013",
    surface: "#161a20",
    ink: "#edeae3",
    muted: "#949aa2",
    body: "#c2c7cd",
    border: "#262b33",
    accent: "#57c7ba",
    accentSoft: "rgba(87, 199, 186, 0.12)"
  },
  light: {
    bg: "#faf8f3",
    surface: "#ffffff",
    ink: "#1b1a17",
    muted: "#6c6a62",
    body: "#43423c",
    border: "#e8e3d7",
    accent: "#0f766e",
    accentSoft: "rgba(15, 118, 110, 0.1)"
  }
} as const;

export type ThemeName = keyof typeof THEMES;
export type Theme = (typeof THEMES)[ThemeName];
export type ThemeProps = {theme: ThemeName};
export const defaultProps: ThemeProps = {theme: "dark"};

const ThemeContext = createContext<Theme>(THEMES.dark);
export const useTheme = () => useContext(ThemeContext);

export const Frame: React.FC<React.PropsWithChildren<ThemeProps>> = ({theme, children}) => {
  const t = THEMES[theme];
  return React.createElement(
    ThemeContext.Provider,
    {value: t},
    React.createElement(
      AbsoluteFill,
      {style: {backgroundColor: t.surface, fontFamily, color: t.ink}},
      children
    )
  );
};

type MonoProps = React.PropsWithChildren<{
  x?: number;
  y?: number;
  size: number;
  color: string;
  align?: "left" | "center" | "right";
  pre?: boolean;
}>;

export const Mono: React.FC<MonoProps> = ({x, y, size, color, align = "left", pre, children}) => {
  const positioned = x !== undefined && y !== undefined;
  const style: React.CSSProperties = {
    fontSize: size,
    lineHeight: 1.45,
    color,
    whiteSpace: pre ? "pre" : "nowrap",
    ...(positioned
      ? {
          position: "absolute",
          top: y,
          left: align === "left" ? x : undefined,
          right: align === "right" ? 1200 - x : undefined,
          ...(align === "center" ? {left: x, transform: "translateX(-50%)"} : {})
        }
      : {})
  };
  return React.createElement("div", {style}, children);
};

type BoxProps = React.PropsWithChildren<{
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill?: string;
  dashed?: boolean;
}>;

export const Box: React.FC<BoxProps> = ({x, y, w, h, stroke, fill, dashed, children}) =>
  React.createElement(
    "div",
    {
      style: {
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        boxSizing: "border-box",
        border: `2px ${dashed ? "dashed" : "solid"} ${stroke}`,
        borderRadius: 14,
        background: fill ?? "transparent",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 22px",
        gap: 4
      }
    },
    children
  );

type LinkProps = {x1: number; y1: number; x2: number; y2: number; color: string; opacity: number};

export const Link: React.FC<LinkProps> = ({x1, y1, x2, y2, color, opacity}) =>
  React.createElement(
    "svg",
    {
      style: {position: "absolute", left: 0, top: 0, opacity},
      width: 1200,
      height: 600,
      viewBox: "0 0 1200 600"
    },
    React.createElement("path", {
      d: `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`,
      fill: "none",
      stroke: color,
      strokeWidth: 3
    })
  );
