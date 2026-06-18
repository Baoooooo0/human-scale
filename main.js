let mapWidth = 1000;
let mapHeight = 600;
const MAP_PADDING = 16;
const MAX_MAP_ZOOM = 8;
const years = [1960, 1970, 1980, 1990, 2000, 2010, 2020, 2024];

const COMPARE_COLOR_A = "#4472c4";
const COMPARE_COLOR_B = "#e74c3c";
const NO_DATA_COLOR = "#b0b0b0";
const MAP_HOVER_COLOR = "#ffcc66";
const DORLING_RADIUS_RANGE = [3, 50];
const DORLING_LABEL_TOP = 20;

let currentMode = "area";
let currentYear = 2024;
let paths = null;
let geoFeatures = null;
let selectedCountries = [null, null];
let isPlaying = false;
let playTimer = null;
const PLAY_INTERVAL = 1200;
const RACE_COUNT = 10;
const RACE_ROW_HEIGHT = 30;
const PREFERS_REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const colorScales = {};

let countryCentroids = new Map();
let dorlingNodes = [];
let dorlingSimulation = null;
let dorlingLayer = null;
let dorlingCirclesLayer = null;
let dorlingLabelsLayer = null;
let dorlingCircles = null;
let dorlingLabels = null;
let raceRowElements = new Map();
let raceBottomRowElements = new Map();
let raceInitialized = false;
let mapZoom = null;
let mapZoomInitialized = false;
let growthMaxAbs = 0.03;

const legendConfig = {
    area: {
        title: "Land Area (km²)",
        format: d => d3.format(",")(Math.round(d))
    },
    population: {
        title: () => `Population (${currentYear})`,
        format: d => formatPopulation(d)
    },
    density: {
        title: () => `Population Density (${currentYear}, people/km²)`,
        format: d => d3.format(",.1f")(d)
    },
    growth: {
        title: () => `Annual Growth Rate (${getGrowthPeriodLabel(currentYear)})`,
        format: d => d3.format("+.2%")(d)
    }
};

const legendWidth = 220;
const legendHeight = 12;

const svg = d3.select("#map-container")
    .append("svg");

const zoomRoot = svg.append("g").attr("class", "zoom-root");
const mapLayer = zoomRoot.append("g").attr("class", "map-layer");

const legendSvg = d3.select("#legend-container")
    .append("svg")
    .attr("width", legendWidth)
    .attr("height", 95);

const legendGradient = legendSvg.append("defs")
    .append("linearGradient")
    .attr("id", "legend-gradient")
    .attr("x1", "0%")
    .attr("x2", "100%")
    .attr("y1", "0%")
    .attr("y2", "0%");

const legendGroup = legendSvg.append("g")
    .attr("class", "legend")
    .attr("transform", "translate(0, 18)");

const projection = d3.geoNaturalEarth1();

const path = d3.geoPath()
    .projection(projection);

function initMapZoom() {
    mapZoom = d3.zoom()
        .scaleExtent([1, MAX_MAP_ZOOM])
        .translateExtent([[0, 0], [mapWidth, mapHeight]])
        .filter(event => event.type !== "dblclick")
        .on("zoom", event => {
            zoomRoot.attr("transform", event.transform);
        });

    svg
        .call(mapZoom)
        .on("dblclick.zoom", null);

    svg.node().addEventListener("wheel", event => event.preventDefault(), { passive: false });
    mapZoomInitialized = true;
}

function resetMapZoom() {
    if (!mapZoom) return;
    svg.call(mapZoom.transform, d3.zoomIdentity);
    zoomRoot.attr("transform", null);
}

function updateMapDimensions() {
    const container = document.getElementById("map-container");
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w < 50 || h < 50) return;

    mapWidth = w;
    mapHeight = h;
    svg.attr("width", w).attr("height", h);

    if (!mapZoomInitialized) {
        initMapZoom();
    } else {
        mapZoom.translateExtent([[0, 0], [w, h]]);
        resetMapZoom();
    }

    if (geoFeatures?.length) {
        projection.fitExtent(
            [[MAP_PADDING, MAP_PADDING], [w - MAP_PADDING, h - MAP_PADDING]],
            { type: "FeatureCollection", features: geoFeatures }
        );
        if (paths) paths.attr("d", path);
        geoFeatures.forEach(f => {
            countryCentroids.set(f.properties.ISO_A3, path.centroid(f));
        });
        dorlingNodes.forEach(node => {
            const [anchorX, anchorY] = countryCentroids.get(node.iso) ?? [mapWidth / 2, mapHeight / 2];
            node.anchorX = anchorX;
            node.anchorY = anchorY;
        });
        if (currentMode === "humanscale" && dorlingSimulation) {
            restartDorlingSimulation(0.35);
        }
    } else {
        projection
            .scale(Math.min(w, h) / 3.2)
            .translate([w / 2, h / 2]);
    }
}

function getPopulation(p, year = currentYear) {
    return p["POP" + year] ?? null;
}

function getGrowthPeriodKey(year = currentYear) {
    return year === 2024 ? 2020 : year;
}

function getGrowthPeriodLabel(year = currentYear) {
    const start = getGrowthPeriodKey(year);
    const end = start === 2020 && year === 2024 ? 2024 : start + 10;
    return `${start}–${end}`;
}

function getGrowthRate(p, year = currentYear) {
    return p["GR" + getGrowthPeriodKey(year)] ?? null;
}

function formatGrowthRate(rate) {
    if (rate == null || !isFinite(rate)) return "No Data";
    return d3.format("+.2%")(rate);
}

function trimUnitValue(value) {
    if (value >= 100) return d3.format(".0f")(value);
    if (value >= 10) return d3.format(".1f")(value).replace(/\.0$/, "");
    return d3.format(".2f")(value).replace(/\.?0+$/, "");
}

function formatPopulation(n) {
    if (n == null || !isFinite(n)) return "No Data";
    if (n >= 1e9) {
        return trimUnitValue(n / 1e9) + "B";
    }
    return trimUnitValue(n / 1e6) + "M";
}

function formatArea(n) {
    if (n == null || !isFinite(n)) return "No Data";
    if (n >= 1e6) return trimUnitValue(n / 1e6) + "M";
    if (n >= 1e3) return trimUnitValue(n / 1e3) + "K";
    return d3.format(",")(Math.round(n));
}

function getDensity(p, year = currentYear) {
    const pop = getPopulation(p, year);
    if (!pop || !p.AREA) return null;
    return pop / p.AREA;
}

function buildRadiusScale(year = currentYear) {
    const pops = geoFeatures
        .map(f => getPopulation(f.properties, year))
        .filter(v => v != null && v > 0);
    const extent = pops.length ? d3.extent(pops) : [1, 1];
    return d3.scaleSqrt().domain(extent).range(DORLING_RADIUS_RANGE);
}

function initDorlingNodes() {
    dorlingNodes = geoFeatures.map(f => {
        const p = f.properties;
        const [anchorX, anchorY] = countryCentroids.get(p.ISO_A3) ?? [mapWidth / 2, mapHeight / 2];
        return {
            iso: p.ISO_A3,
            name: p.NAME,
            feature: f,
            anchorX,
            anchorY,
            x: anchorX,
            y: anchorY,
            pop: null,
            radius: DORLING_RADIUS_RANGE[0]
        };
    });
}

function applyDorlingYear(year = currentYear) {
    const radiusScale = buildRadiusScale(year);
    dorlingNodes.forEach(node => {
        node.pop = getPopulation(node.feature.properties, year);
        node.radius = node.pop ? radiusScale(node.pop) : DORLING_RADIUS_RANGE[0];
    });
}

function getTopLabelIsos(count = DORLING_LABEL_TOP) {
    return new Set(getRankedCountries(count, currentYear, "population").map(d => d.iso));
}

function shouldShowDorlingLabel(node, topIsos) {
    if (!node.pop) return false;
    if (topIsos.has(node.iso)) return true;
    if (selectedCountries[0]?.properties.ISO_A3 === node.iso) return true;
    if (selectedCountries[1]?.properties.ISO_A3 === node.iso) return true;
    return false;
}

function raiseDorlingLabels(topIsos) {
    if (!dorlingLabels) return;

    const visible = dorlingNodes
        .filter(d => shouldShowDorlingLabel(d, topIsos))
        .sort((a, b) => {
            const rank = iso => {
                if (selectedCountries[1]?.properties.ISO_A3 === iso) return 3;
                if (selectedCountries[0]?.properties.ISO_A3 === iso) return 2;
                return 1;
            };
            return (rank(a.iso) - rank(b.iso)) || ((a.pop ?? 0) - (b.pop ?? 0));
        });

    visible.forEach(d => {
        dorlingLabels.filter(node => node.iso === d.iso).raise();
    });
}

function dorlingTick() {
    if (!dorlingCircles) return;
    dorlingCircles
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);
    dorlingLabels
        .attr("transform", d => `translate(${d.x},${d.y})`);
    raiseDorlingLabels(getTopLabelIsos());
}

function restartDorlingSimulation(alpha = 0.65) {
    if (!dorlingNodes.length) return;

    if (!dorlingSimulation) {
        dorlingSimulation = d3.forceSimulation(dorlingNodes)
            .force("x", d3.forceX(d => d.anchorX).strength(0.12))
            .force("y", d3.forceY(d => d.anchorY).strength(0.12))
            .force("collide", d3.forceCollide(d => d.radius + 1.5).iterations(3))
            .alphaDecay(0.028)
            .on("tick", dorlingTick);
    } else {
        dorlingSimulation.nodes(dorlingNodes);
    }

    dorlingSimulation.force(
        "collide",
        d3.forceCollide(d => d.radius + 1.5).iterations(3)
    );
    dorlingSimulation.alpha(alpha).restart();
}

function stopDorlingSimulation() {
    if (dorlingSimulation) {
        dorlingSimulation.stop();
    }
}

function initDorlingLayer() {
    if (dorlingLayer) return;

    applyDorlingYear(currentYear);

    dorlingLayer = zoomRoot.append("g")
        .attr("class", "dorling-layer")
        .style("display", "none");

    dorlingCirclesLayer = dorlingLayer.append("g").attr("class", "dorling-circles-layer");
    dorlingLabelsLayer = dorlingLayer.append("g").attr("class", "dorling-labels-layer");

    dorlingCirclesLayer.selectAll("circle.dorling-circle")
        .data(dorlingNodes, d => d.iso)
        .enter()
        .append("circle")
        .attr("class", "dorling-circle")
        .attr("r", d => d.radius)
        .on("click", (event, d) => handleCountryClick(event, d.feature))
        .on("mouseover", function (event, d) {
            if (!isSelected(d.feature)) {
                d3.select(this).attr("fill", MAP_HOVER_COLOR);
            }
        })
        .on("mouseout", function (event, d) {
            d3.select(this).attr("fill", getFillColor(d.feature));
        });

    dorlingLabelsLayer.selectAll("text.dorling-label")
        .data(dorlingNodes, d => d.iso)
        .enter()
        .append("text")
        .attr("class", "dorling-label")
        .attr("text-anchor", "middle")
        .attr("pointer-events", "none");

    dorlingCircles = dorlingCirclesLayer.selectAll("circle.dorling-circle");
    dorlingLabels = dorlingLabelsLayer.selectAll("text.dorling-label");

    dorlingTick();
    refreshDorlingVisuals(false);
}

function refreshDorlingVisuals(animateRadius = true) {
    if (!dorlingCircles) return;

    const topIsos = getTopLabelIsos();
    const animate = animateRadius && !PREFERS_REDUCED_MOTION;

    dorlingCircles.each(function (d) {
        const el = d3.select(this);
        const fill = getFillColor(d.feature);
        const dim = isCompareMode() && !isSelected(d.feature);

        el.classed("compare-dim", dim)
            .classed("dorling-selected-a", selectedCountries[0]?.properties.ISO_A3 === d.iso)
            .classed("dorling-selected-b", selectedCountries[1]?.properties.ISO_A3 === d.iso);

        if (PREFERS_REDUCED_MOTION) {
            el.attr("fill", fill).attr("r", d.radius);
        } else {
            gsap.to(this, {
                attr: { fill, r: d.radius },
                duration: animate ? 0.35 : 0,
                ease: "power1.out",
                overwrite: "auto"
            });
        }
    });

    dorlingLabels.each(function (d) {
        const show = shouldShowDorlingLabel(d, topIsos);
        const el = d3.select(this);

        if (!show) {
            el.text("");
            el.style("opacity", 0);
            return;
        }

        el.style("opacity", 1);
        el.selectAll("tspan").remove();
        el.append("tspan")
            .attr("x", 0)
            .attr("dy", "-0.35em")
            .text(d.name);
        el.append("tspan")
            .attr("x", 0)
            .attr("dy", "1.15em")
            .attr("class", "dorling-label-pop")
            .text(formatPopulation(d.pop));
    });

    raiseDorlingLabels(topIsos);
}

function showDorlingView(animateIn = true) {
    initDorlingLayer();
    applyDorlingYear(currentYear);
    refreshDorlingVisuals(!animateIn);
    restartDorlingSimulation(0.75);

    const mapContainer = document.getElementById("map-container");

    if (animateIn && !PREFERS_REDUCED_MOTION) {
        gsap.to(mapLayer.node(), {
            opacity: 0,
            duration: 0.25,
            onComplete: () => {
                mapLayer.style("display", "none");
                dorlingLayer.style("display", null).style("opacity", 0);
                gsap.to(dorlingLayer.node(), { opacity: 1, duration: 0.35 });
            }
        });
    } else {
        mapLayer.style("display", "none").style("opacity", 1);
        dorlingLayer.style("display", null).style("opacity", 1);
    }

    mapContainer.classList.add("dorling-active");
}

function hideDorlingView(animateOut = true) {
    stopDorlingSimulation();

    const mapContainer = document.getElementById("map-container");
    mapContainer.classList.remove("dorling-active");

    if (!dorlingLayer) {
        mapLayer.style("display", null);
        return;
    }

    if (animateOut && !PREFERS_REDUCED_MOTION) {
        gsap.to(dorlingLayer.node(), {
            opacity: 0,
            duration: 0.25,
            onComplete: () => {
                dorlingLayer.style("display", "none");
                mapLayer.style("display", null).style("opacity", 0);
                gsap.to(mapLayer.node(), { opacity: 1, duration: 0.35 });
            }
        });
    } else {
        dorlingLayer.style("display", "none");
        mapLayer.style("display", null).style("opacity", 1);
    }
}

function updateDorlingForYear(animate = true) {
    if (currentMode !== "humanscale" || !dorlingLayer) return;
    applyDorlingYear(currentYear);
    refreshDorlingVisuals(animate);
    restartDorlingSimulation(animate ? 0.55 : 0.35);
}

function growthColor(value) {
    if (value == null || !isFinite(value)) return "#e0e0e0";
    if (value < 0) {
        const ratio = Math.min(Math.abs(value) / growthMaxAbs, 1);
        return d3.interpolateReds(0.45 + ratio * 0.55);
    }
    if (value === 0) return "#fee08b";
    const ratio = Math.min(value / growthMaxAbs, 1);
    return d3.interpolateRdYlGn(0.5 + ratio * 0.5);
}

function buildScale(mode, features) {
    const values = features
        .map(f => getMetricValue(mode, f.properties))
        .filter(v => v != null && isFinite(v));

    if (mode === "growth") {
        growthMaxAbs = d3.max(values, v => Math.abs(v)) || 0.03;
        colorScales.growth = growthColor;
        return;
    }

    colorScales[mode] = d3.scaleSequential()
        .domain(d3.extent(values))
        .interpolator(d3.interpolateBlues);
}

function buildHumanScaleScale(features) {
    const values = features
        .map(f => getDensity(f.properties))
        .filter(v => v != null && isFinite(v));
    colorScales.humanscale = d3.scaleSequential()
        .domain(d3.extent(values.length ? values : [0, 1]))
        .interpolator(t => d3.interpolateRdYlGn(1 - t));
}

function buildScales(features) {
    ["area", "population", "density", "growth"].forEach(mode => buildScale(mode, features));
    buildHumanScaleScale(features);
}

function rebuildYearScales(features) {
    ["population", "density", "growth"].forEach(mode => buildScale(mode, features));
    buildHumanScaleScale(features);
}

function isCompareMode() {
    return selectedCountries[0] && selectedCountries[1];
}

function isSelected(d) {
    return selectedCountries.some(f => f && f.properties.ISO_A3 === d.properties.ISO_A3);
}

function highlightCountryOnMap(iso) {
    if (!iso) return;

    if (currentMode === "humanscale" && dorlingCircles) {
        dorlingCircles.filter(d => d.iso === iso).each(function (d) {
            if (!isSelected(d.feature)) {
                d3.select(this).attr("fill", MAP_HOVER_COLOR);
            }
        });
        return;
    }

    if (!paths) return;
    paths.filter(d => d.properties.ISO_A3 === iso).each(function (d) {
        if (!isSelected(d)) {
            d3.select(this).attr("fill", MAP_HOVER_COLOR);
        }
    });
}

function clearCountryMapHighlight(iso) {
    if (!iso) return;

    if (currentMode === "humanscale" && dorlingCircles) {
        dorlingCircles.filter(d => d.iso === iso).each(function (d) {
            d3.select(this).attr("fill", getFillColor(d.feature));
        });
        return;
    }

    if (!paths) return;
    paths.filter(d => d.properties.ISO_A3 === iso).each(function (d) {
        d3.select(this).attr("fill", getFillColor(d));
    });
}

function getFillColor(d) {
    if (isCompareMode()) {
        const iso = d.properties.ISO_A3;
        if (selectedCountries[0].properties.ISO_A3 === iso) return COMPARE_COLOR_A;
        if (selectedCountries[1].properties.ISO_A3 === iso) return COMPARE_COLOR_B;
        return "#e8e8e8";
    }
    if (selectedCountries[0] && selectedCountries[0].properties.ISO_A3 === d.properties.ISO_A3) {
        return COMPARE_COLOR_A;
    }
    if (currentMode === "humanscale") {
        const density = getDensity(d.properties);
        if (density == null) return NO_DATA_COLOR;
        return colorScales.humanscale(density);
    }
    const value = getMetricValue(currentMode, d.properties);
    if (value == null) return "#e0e0e0";
    if (currentMode === "growth") return growthColor(value);
    return colorScales[currentMode](value);
}

function drawCompareLegend(a, b) {
    legendGroup.selectAll("*").remove();

    legendGroup.append("text")
        .attr("class", "legend-title")
        .attr("x", 0)
        .attr("y", -8)
        .text("Country Compare");

    const rowA = legendGroup.append("g").attr("transform", "translate(0, 4)");
    rowA.append("rect")
        .attr("width", 14)
        .attr("height", 14)
        .attr("fill", COMPARE_COLOR_A);
    rowA.append("text")
        .attr("class", "legend-label")
        .attr("x", 20)
        .attr("y", 11)
        .text(a.properties.NAME);

    const rowB = legendGroup.append("g").attr("transform", "translate(0, 24)");
    rowB.append("rect")
        .attr("width", 14)
        .attr("height", 14)
        .attr("fill", COMPARE_COLOR_B);
    rowB.append("text")
        .attr("class", "legend-label")
        .attr("x", 20)
        .attr("y", 11)
        .text(b.properties.NAME);
}

function drawHumanScaleLegend() {
    legendGroup.selectAll("*").remove();
    legendSvg.attr("height", 138);

    const scale = colorScales.humanscale;
    const densities = geoFeatures
        .map(f => getDensity(f.properties))
        .filter(v => v != null && isFinite(v));
    const [minD, maxD] = d3.extent(densities);

    legendGradient.selectAll("stop").remove();
    for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const value = minD + t * (maxD - minD);
        legendGradient.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", scale(value));
    }

    legendGroup.append("text")
        .attr("class", "legend-title")
        .attr("x", 0)
        .attr("y", -8)
        .text(`Human Scale (${currentYear})`);

    legendGroup.append("text")
        .attr("class", "legend-label")
        .attr("x", 0)
        .attr("y", 10)
        .text("Circle size ∝ population");

    const [minR, maxR] = DORLING_RADIUS_RANGE;
    const pops = geoFeatures.map(f => getPopulation(f.properties)).filter(Boolean);
    const [minPop, maxPop] = d3.extent(pops);

    [
        { x: 24, r: minR, label: formatPopulation(minPop), fill: scale(minD) },
        { x: 148, r: maxR, label: formatPopulation(maxPop), fill: scale(maxD) }
    ].forEach(s => {
        const g = legendGroup.append("g").attr("transform", `translate(${s.x}, 30)`);
        g.append("circle")
            .attr("r", s.r * 0.32)
            .attr("fill", s.fill)
            .attr("stroke", "#555")
            .attr("stroke-width", 0.5);
        g.append("text")
            .attr("class", "legend-label")
            .attr("y", s.r * 0.32 + 11)
            .attr("text-anchor", "middle")
            .text(s.label);
    });

    legendGroup.append("text")
        .attr("class", "legend-label")
        .attr("x", 0)
        .attr("y", 58)
        .text("Color = density");

    legendGroup.append("rect")
        .attr("y", 64)
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .attr("fill", "url(#legend-gradient)")
        .attr("stroke", "#999")
        .attr("stroke-width", 0.5);

    legendGroup.append("text")
        .attr("class", "legend-label")
        .attr("x", 0)
        .attr("y", 64 + legendHeight + 14)
        .text(d3.format(",.0f")(minD));

    legendGroup.append("text")
        .attr("class", "legend-label")
        .attr("x", legendWidth)
        .attr("y", 64 + legendHeight + 14)
        .attr("text-anchor", "end")
        .text(d3.format(",.0f")(maxD));

    const noData = legendGroup.append("g")
        .attr("transform", `translate(0, ${64 + legendHeight + 24})`);

    noData.append("rect")
        .attr("width", 14)
        .attr("height", 14)
        .attr("fill", NO_DATA_COLOR)
        .attr("stroke", "#999")
        .attr("stroke-width", 0.5);

    noData.append("text")
        .attr("class", "legend-label")
        .attr("x", 20)
        .attr("y", 11)
        .text("No Data");
}

function refreshLegend() {
    if (isCompareMode()) {
        drawCompareLegend(selectedCountries[0], selectedCountries[1]);
    } else if (currentMode === "humanscale") {
        drawHumanScaleLegend();
    } else {
        drawLegend(currentMode);
    }
}

function getLegendExtent(mode) {
    if (mode === "growth") {
        return [-growthMaxAbs, growthMaxAbs];
    }
    return colorScales[mode].domain();
}

function updateLegendGradient(mode) {
    const [min, max] = getLegendExtent(mode);
    const steps = 20;

    legendGradient.selectAll("stop").remove();

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const value = min + t * (max - min);
        const color = mode === "growth" ? growthColor(value) : colorScales[mode](value);
        legendGradient.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", color);
    }
}

function drawLegend(mode) {
    legendSvg.attr("height", 95);
    const config = legendConfig[mode];
    const [min, max] = getLegendExtent(mode);
    const title = typeof config.title === "function" ? config.title() : config.title;

    updateLegendGradient(mode);

    legendGroup.selectAll("*").remove();

    legendGroup.append("text")
        .attr("class", "legend-title")
        .attr("x", 0)
        .attr("y", -8)
        .text(title);

    legendGroup.append("rect")
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .attr("fill", "url(#legend-gradient)")
        .attr("stroke", "#999")
        .attr("stroke-width", 0.5);

    legendGroup.append("text")
        .attr("class", "legend-label")
        .attr("x", 0)
        .attr("y", legendHeight + 16)
        .text(config.format(min));

    legendGroup.append("text")
        .attr("class", "legend-label")
        .attr("x", legendWidth)
        .attr("y", legendHeight + 16)
        .attr("text-anchor", "end")
        .text(config.format(max));

    const noData = legendGroup.append("g")
        .attr("transform", `translate(0, ${legendHeight + 28})`);

    noData.append("rect")
        .attr("width", 14)
        .attr("height", 14)
        .attr("fill", "#e0e0e0")
        .attr("stroke", "#999")
        .attr("stroke-width", 0.5);

    noData.append("text")
        .attr("class", "legend-label")
        .attr("x", 20)
        .attr("y", 11)
        .text("No Data");
}

function refreshMapColors() {
    if (!paths) return;

    paths.each(function (d) {
        const el = d3.select(this);
        const targetFill = getFillColor(d);
        const isDim = isCompareMode() && !isSelected(d);

        if (PREFERS_REDUCED_MOTION) {
            el.attr("fill", targetFill);
        } else {
            gsap.to(this, {
                attr: { fill: targetFill },
                duration: 0.35,
                ease: "power1.out",
                overwrite: "auto"
            });
        }
        el.classed("compare-dim", isDim);
    });
}

function refreshVisuals() {
    if (currentMode === "humanscale") {
        refreshDorlingVisuals(false);
    } else {
        refreshMapColors();
    }
    refreshLegend();
}

function updateMap(mode) {
    const prevMode = currentMode;
    currentMode = mode;

    document.querySelectorAll("#controls button").forEach(btn => {
        btn.classList.remove("active");
    });

    const btnMap = {
        area: "areaBtn",
        population: "popBtn",
        density: "densityBtn",
        growth: "growthBtn",
        humanscale: "humanScaleBtn"
    };
    document.getElementById(btnMap[mode]).classList.add("active");

    const mapContainer = document.getElementById("map-container");
    mapContainer.classList.add("mode-transition");

    const finishUpdate = () => {
        if (mode === "humanscale" && prevMode !== "humanscale") {
            rebuildYearScales(geoFeatures);
            showDorlingView(true);
        } else if (mode !== "humanscale" && prevMode === "humanscale") {
            hideDorlingView(true);
            refreshMapColors();
        }

        refreshVisuals();
        updateInfoPanel();
        updateRaceChart(false);

        gsap.to(mapContainer, {
            opacity: 1,
            duration: PREFERS_REDUCED_MOTION ? 0 : 0.25,
            onComplete: () => mapContainer.classList.remove("mode-transition")
        });
    };

    if (PREFERS_REDUCED_MOTION) {
        finishUpdate();
    } else {
        gsap.to(mapContainer, {
            opacity: 0.65,
            duration: 0.15,
            onComplete: finishUpdate
        });
    }
}

function updateYear(year, syncSlider = true) {
    const prevYear = currentYear;
    currentYear = year;
    document.getElementById("yearLabel").textContent = year;

    if (syncSlider) {
        const index = years.indexOf(year);
        if (index >= 0) {
            document.getElementById("yearSlider").value = index;
        }
    }

    if (geoFeatures) {
        rebuildYearScales(geoFeatures);
    }

    if (currentMode === "humanscale" && prevYear !== year) {
        updateDorlingForYear(true);
    }

    refreshVisuals();
    updateInfoPanel();

    updateRaceChart(true);
}

function setYearByIndex(index) {
    updateYear(years[index], true);
}

function stopPlay() {
    isPlaying = false;
    const playBtn = document.getElementById("playBtn");
    playBtn.textContent = "▶ Play";
    playBtn.classList.remove("playing");

    if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
    }
}

function startPlay() {
    isPlaying = true;
    const playBtn = document.getElementById("playBtn");
    playBtn.textContent = "⏸ Pause";
    playBtn.classList.add("playing");

    playTimer = setInterval(() => {
        let index = years.indexOf(currentYear);
        index = index >= years.length - 1 ? 0 : index + 1;
        setYearByIndex(index);
    }, PLAY_INTERVAL);
}

function togglePlay() {
    if (isPlaying) {
        stopPlay();
    } else {
        startPlay();
    }
}

function handleCountryClick(event, d) {
    const iso = d.properties.ISO_A3;

    if (selectedCountries[0] && selectedCountries[0].properties.ISO_A3 === iso) {
        selectedCountries[0] = selectedCountries[1];
        selectedCountries[1] = null;
    } else if (selectedCountries[1] && selectedCountries[1].properties.ISO_A3 === iso) {
        selectedCountries[1] = null;
    } else if (!selectedCountries[0]) {
        selectedCountries[0] = d;
    } else if (!selectedCountries[1]) {
        selectedCountries[1] = d;
    } else {
        selectedCountries[0] = d;
        selectedCountries[1] = null;
    }

    refreshVisuals();
    updateInfoPanel();

    updateRaceChart(true);
}

function compareValueHtml(aVal, bVal, formatter) {
    const a = formatter(aVal);
    const b = formatter(bVal);
    return `<span class="vs-a">${a}</span><span class="vs-sep">vs</span><span class="vs-b">${b}</span>`;
}

function showCompareInfo(a, b) {
    const pa = a.properties;
    const pb = b.properties;

    document.getElementById("panel-title").textContent = "Country Compare";
    document.getElementById("country-name").innerHTML =
        `<span class="vs-a">${pa.NAME}</span> <span class="vs-sep">vs</span> <span class="vs-b">${pb.NAME}</span>`;

    document.getElementById("single-stats").classList.add("hidden");
    document.getElementById("compare-stats").classList.remove("hidden");
    document.getElementById("trajectory-section").classList.add("hidden");

    document.getElementById("compare-pop").innerHTML = compareValueHtml(
        getPopulation(pa), getPopulation(pb), formatPopulation
    );
    document.getElementById("compare-area").innerHTML = compareValueHtml(
        pa.AREA, pb.AREA, v => v ? formatArea(v) + " km²" : "No Data"
    );
    document.getElementById("compare-density").innerHTML = compareValueHtml(
        getDensity(pa), getDensity(pb), v => v ? d3.format(",.0f")(v) + " people/km²" : "No Data"
    );
}

function showSingleCountryInfo(feature) {
    const p = feature.properties;
    const pop = getPopulation(p);
    const density = getDensity(p);

    document.getElementById("panel-title").textContent = "Country Information";
    document.getElementById("country-name").textContent = p.NAME;

    document.getElementById("single-stats").classList.remove("hidden");
    document.getElementById("compare-stats").classList.add("hidden");
    document.getElementById("trajectory-section").classList.remove("hidden");

    document.getElementById("population").innerText = pop
        ? `Population (${currentYear}): ${formatPopulation(pop)}`
        : "Population: No Data";

    document.getElementById("area").innerText = p.AREA
        ? `Area: ${p.AREA.toLocaleString()} km²`
        : "Area: No Data";

    document.getElementById("density").innerText = density
        ? `Density: ${d3.format(",.1f")(density)} people/km²`
        : "Density: No Data";

    const growth = getGrowthRate(p);
    document.getElementById("growth").innerText = growth != null
        ? `Growth (${getGrowthPeriodLabel()}): ${formatGrowthRate(growth)} / yr`
        : `Growth (${getGrowthPeriodLabel()}): No Data`;

    drawTrajectoryChart(feature);
}

function showEmptyInfo() {
    document.getElementById("panel-title").textContent = "Country Information";
    document.getElementById("country-name").textContent = "Click a country";
    document.getElementById("single-stats").classList.remove("hidden");
    document.getElementById("compare-stats").classList.add("hidden");
    document.getElementById("trajectory-section").classList.add("hidden");

    document.getElementById("population").innerText = "";
    document.getElementById("area").innerText = "";
    document.getElementById("density").innerText = "";
    document.getElementById("growth").innerText = "";
}

function updateInfoPanel() {
    if (isCompareMode()) {
        showCompareInfo(selectedCountries[0], selectedCountries[1]);
    } else if (selectedCountries[0]) {
        showSingleCountryInfo(selectedCountries[0]);
    } else {
        showEmptyInfo();
    }
}

function drawTrajectoryChart(feature) {
    const p = feature.properties;
    const data = years.map(y => ({
        year: y,
        pop: getPopulation(p, y)
    })).filter(d => d.pop != null);

    const container = document.getElementById("trajectory-chart");
    const chartWidth = Math.max(container.clientWidth || 0, 260);
    const chartHeight = 96;
    const margin = { top: 12, right: 6, bottom: 24, left: 6 };

    d3.select(container).selectAll("*").remove();

    if (data.length < 2) {
        container.innerHTML = "<p style='color:#888;font-size:13px'>No historical data</p>";
        return;
    }

    const innerWidth = chartWidth - margin.left - margin.right;
    const innerHeight = chartHeight - margin.top - margin.bottom;

    const svgChart = d3.select(container)
        .append("svg")
        .attr("width", chartWidth)
        .attr("height", chartHeight)
        .attr("viewBox", `0 0 ${chartWidth} ${chartHeight}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const plot = svgChart.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
        .domain(d3.extent(data, d => d.year))
        .range([0, innerWidth]);

    const y = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.pop) * 1.08])
        .range([innerHeight, 0]);

    const line = d3.line()
        .x(d => x(d.year))
        .y(d => y(d.pop));

    plot.append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", COMPARE_COLOR_A)
        .attr("stroke-width", 2)
        .attr("d", line);

    plot.selectAll(".trajectory-dot")
        .data(data)
        .enter()
        .append("circle")
        .attr("class", "trajectory-dot")
        .attr("cx", d => x(d.year))
        .attr("cy", d => y(d.pop))
        .attr("r", d => d.year === currentYear ? 5 : 3)
        .attr("fill", d => d.year === currentYear ? COMPARE_COLOR_A : "#aaa");

    const tickYears = [1960, 1980, 2000, 2024].filter(y => data.some(d => d.year === y));
    const firstTick = tickYears[0];
    const lastTick = tickYears[tickYears.length - 1];

    plot.selectAll(".trajectory-label")
        .data(tickYears)
        .enter()
        .append("text")
        .attr("class", "trajectory-label")
        .attr("x", y => x(y))
        .attr("y", innerHeight + 16)
        .attr("text-anchor", y => {
            if (y === firstTick) return "start";
            if (y === lastTick) return "end";
            return "middle";
        })
        .attr("font-size", 10)
        .attr("fill", "#888")
        .text(y => y);
}

function getMetricValue(mode, p, year = currentYear) {
    if (mode === "area") return p.AREA;
    if (mode === "population") return getPopulation(p, year);
    if (mode === "density") return getDensity(p, year);
    if (mode === "growth") return getGrowthRate(p, year);
    return null;
}

function getRankingMode(mode = currentMode) {
    return mode === "humanscale" ? "population" : mode;
}

function getRankingTitle(mode = currentMode) {
    const titles = {
        area: "Top 10 Land Area",
        population: "Top 10 Population",
        density: "Top 10 Density",
        growth: "Top 10 Growth Rate"
    };
    return titles[getRankingMode(mode)] || "Top 10 Population";
}

function getRankingYearLabel(mode = currentMode, year = currentYear) {
    const rankingMode = getRankingMode(mode);
    if (rankingMode === "growth") return `(${getGrowthPeriodLabel(year)})`;
    if (rankingMode === "area") return "";
    return `(${year})`;
}

function formatRankValue(value, mode = currentMode) {
    const rankingMode = getRankingMode(mode);
    if (rankingMode === "growth") return formatGrowthRate(value);
    if (rankingMode === "density") return d3.format(",.0f")(value) + " people/km²";
    if (rankingMode === "area") return formatArea(value) + " km²";
    return formatPopulation(value);
}

function getRankedCountries(count = RACE_COUNT, year = currentYear, mode = currentMode) {
    const rankingMode = getRankingMode(mode);
    let results = geoFeatures
        .map(f => ({
            name: f.properties.NAME,
            iso: f.properties.ISO_A3,
            value: getMetricValue(rankingMode, f.properties, year)
        }))
        .filter(d => d.value != null && isFinite(d.value));

    if (rankingMode === "growth") {
        results = results.filter(d => d.value > 0);
    }

    return results
        .sort((a, b) => b.value - a.value)
        .slice(0, count);
}

function getBottomRankedCountries(count = RACE_COUNT, year = currentYear) {
    return geoFeatures
        .map(f => ({
            name: f.properties.NAME,
            iso: f.properties.ISO_A3,
            value: getGrowthRate(f.properties, year)
        }))
        .filter(d => d.value != null && isFinite(d.value) && d.value < 0)
        .sort((a, b) => a.value - b.value)
        .slice(0, count);
}

function getAllRaceCandidates() {
    const byIso = new Map();
    const modes = ["population", "density", "growth", "area"];
    years.forEach(year => {
        modes.forEach(mode => {
            getRankedCountries(RACE_COUNT, year, mode).forEach(d => {
                if (!byIso.has(d.iso)) byIso.set(d.iso, d.name);
            });
        });
        getBottomRankedCountries(RACE_COUNT, year).forEach(d => {
            if (!byIso.has(d.iso)) byIso.set(d.iso, d.name);
        });
    });
    return [...byIso.entries()].map(([iso, name]) => ({ iso, name }));
}

function buildRaceRow(iso, name) {
    const row = document.createElement("div");
    row.className = "race-row";
    row.dataset.iso = iso;
    row.style.top = `${RACE_COUNT * RACE_ROW_HEIGHT}px`;
    row.style.opacity = "0";
    row.innerHTML =
        `<span class="race-rank"></span>` +
        `<span class="race-name">${name}</span>` +
        `<div class="race-bar-wrap"><div class="race-bar"></div></div>` +
        `<span class="race-pop"></span>`;
    row.addEventListener("click", () => handleRaceRowClick(iso));

    const nameEl = row.querySelector(".race-name");
    nameEl.addEventListener("mouseenter", () => highlightCountryOnMap(iso));
    nameEl.addEventListener("mouseleave", () => clearCountryMapHighlight(iso));

    return row;
}

function handleRaceRowClick(iso) {
    const feature = geoFeatures?.find(f => f.properties.ISO_A3 === iso);
    if (!feature) return;
    handleCountryClick(null, feature);
}

function initRaceChartContainer(container, rowElements, candidates) {
    container.innerHTML = "";
    rowElements.clear();
    candidates.forEach(({ iso, name }) => {
        const row = buildRaceRow(iso, name);
        container.appendChild(row);
        rowElements.set(iso, row);
    });
}

function initRaceChart() {
    const candidates = getAllRaceCandidates();
    initRaceChartContainer(document.getElementById("race-chart"), raceRowElements, candidates);
    initRaceChartContainer(document.getElementById("race-chart-bottom"), raceBottomRowElements, candidates);
    raceInitialized = true;
    updateRaceChart(false);
}

function updateRacePanel(rowElements, ranked, panelMode, animate) {
    const formatMode = panelMode === "growth-negative" ? "growth" : currentMode;
    const maxValue = panelMode === "growth-negative"
        ? Math.abs(ranked[0]?.value ?? 1)
        : ranked[0]?.value ?? 1;
    const duration = animate && !PREFERS_REDUCED_MOTION ? 0.65 : 0;
    const activeIsos = new Set(ranked.map(d => d.iso));
    const useAbsBar = panelMode === "growth" || panelMode === "growth-negative";

    ranked.forEach((item, index) => {
        const row = rowElements.get(item.iso);
        if (!row) return;

        const targetY = index * RACE_ROW_HEIGHT;
        const barWidth = useAbsBar
            ? (Math.abs(item.value) / Math.abs(maxValue)) * 100
            : (item.value / maxValue) * 100;

        row.querySelector(".race-rank").textContent = index + 1;
        row.querySelector(".race-pop").textContent = formatRankValue(item.value, formatMode);
        row.classList.toggle("highlight-a", selectedCountries[0]?.properties.ISO_A3 === item.iso);
        row.classList.toggle("highlight-b", selectedCountries[1]?.properties.ISO_A3 === item.iso);

        if (duration === 0) {
            gsap.set(row, { top: targetY, opacity: 1 });
            row.querySelector(".race-bar").style.width = `${barWidth}%`;
        } else {
            gsap.to(row, { top: targetY, opacity: 1, duration, ease: "power2.out" });
            gsap.to(row.querySelector(".race-bar"), {
                width: `${barWidth}%`,
                duration,
                ease: "power2.out"
            });
        }
    });

    rowElements.forEach((row, iso) => {
        if (!activeIsos.has(iso)) {
            gsap.to(row, {
                opacity: 0,
                top: RACE_COUNT * RACE_ROW_HEIGHT,
                duration: duration || 0,
                ease: "power2.in"
            });
        }
    });
}

function updateRaceChart(animate = true) {
    if (!geoFeatures || !raceInitialized) return;

    const rankingMode = getRankingMode();
    const ranked = getRankedCountries(RACE_COUNT);
    const duration = animate && !PREFERS_REDUCED_MOTION ? 0.65 : 0;

    document.getElementById("race-title").textContent = getRankingTitle();
    document.getElementById("race-year").textContent = getRankingYearLabel();

    const raceChart = document.getElementById("race-chart");
    raceChart.classList.toggle("growth-mode", rankingMode === "growth");
    raceChart.classList.toggle("density-mode", rankingMode === "density");
    raceChart.classList.toggle("area-mode", rankingMode === "area");

    updateRacePanel(raceRowElements, ranked, rankingMode, animate);

    const bottomSection = document.getElementById("race-bottom-section");
    const bottomRanked = rankingMode === "growth" ? getBottomRankedCountries() : [];

    if (bottomRanked.length) {
        bottomSection.classList.remove("hidden");
        document.getElementById("race-bottom-title").textContent = "Bottom 10 Growth Rate";
        document.getElementById("race-bottom-year").textContent = getRankingYearLabel();
        updateRacePanel(raceBottomRowElements, bottomRanked, "growth-negative", animate);
    } else {
        bottomSection.classList.add("hidden");
        raceBottomRowElements.forEach(row => {
            gsap.to(row, {
                opacity: 0,
                top: RACE_COUNT * RACE_ROW_HEIGHT,
                duration: duration || 0,
                ease: "power2.in"
            });
        });
    }
}

document.getElementById("areaBtn").onclick = () => updateMap("area");
document.getElementById("popBtn").onclick = () => updateMap("population");
document.getElementById("densityBtn").onclick = () => updateMap("density");
document.getElementById("growthBtn").onclick = () => updateMap("growth");
document.getElementById("humanScaleBtn").onclick = () => updateMap("humanscale");

document.getElementById("playBtn").onclick = togglePlay;

document.getElementById("yearSlider").oninput = function () {
    stopPlay();
    updateYear(years[+this.value], false);
};

d3.json("./data/world_population.geojson")
    .then(data => {
        geoFeatures = data.features;
        buildScales(geoFeatures);

        paths = mapLayer.selectAll("path")
            .data(geoFeatures)
            .enter()
            .append("path")
            .attr("class", "country-path")
            .attr("d", path)
            .attr("stroke", "#333")
            .attr("stroke-width", 0.5)
            .on("click", function (event, d) {
                handleCountryClick(event, d);
            })
            .on("mouseover", function (event, d) {
                if (!isSelected(d)) {
                    d3.select(this).attr("fill", MAP_HOVER_COLOR);
                }
            })
            .on("mouseout", function (event, d) {
                d3.select(this).attr("fill", getFillColor(d));
            });

        updateMapDimensions();
        initDorlingNodes();
        initRaceChart();
        updateMap("area");
    });

new ResizeObserver(() => updateMapDimensions())
    .observe(document.getElementById("map-container"));
