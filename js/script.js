const NASA_API_KEY = "dgwT9MFSrDqtuoH10bDxAbpS2snlRM8ebcRfNvwv";
const NEO_API_BASE_URL = "https://api.nasa.gov/neo/rest/v1/feed";
const APOD_API_URL = "https://api.nasa.gov/planetary/apod";

const DEFAULT_DENSITY_KG_M3 = 3000;
const BUILDING_DAMAGE_THRESHOLD_PSI = 5;
const SHOCKWAVE_MAX_RADIUS_M = 5000;
const CITY_SIZE = 500;
const BUILDING_COUNT = 100;
const JOULES_TO_MEGATONS = 4.184e15;
const EARTH_RADIUS_SIMULATION = 4000;

const MOCK_BUILDING_VALUE_USD = 100000;
const MOCK_WINDOW_DAMAGE_COST = 5000;
const MOCK_POP_DENSITY_SQKM = 5000;
const CASUALTY_RATE_STRUCTURAL = 0.05;
const CASUALTY_RATE_THERMAL_MINOR = 0.005;

const HISTORICAL_FIREBALLS = [
    { name: "Chelyabinsk (2013)", energy: 0.5, altitude: 29.7, color: 0x9333ea },
    { name: "Tunguska (1908)", energy: 12.0, altitude: 8.0, color: 0xef4444 }
];

let scene, camera, renderer;
let buildings = [];
let shockwaveMesh, thermalMesh, burstMarker;
let asteroidData = [];
let fireballMarkers = [];

let currentMaxDamageRadiusM = 0;
let cameraRadius = 3500;
let theta = 45;
let phi = 60;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
const orbitSpeed = 0.5;
const orbitClampMin = 10;
const orbitClampMax = 80;
let isApiDataSelected = false;

const canvasContainer = document.getElementById('city-view');
const diameterInput = document.getElementById('diameter');
const velocityInput = document.getElementById('velocity');
const angleInput = document.getElementById('angle');
const diameterValueDisplay = document.getElementById('diameter-value');
const velocityValueDisplay = document.getElementById('velocity-value');
const angleValueDisplay = document.getElementById('angle-value');
const burstAltitudeDisplay = document.getElementById('burst-altitude-display');
const energyYieldDisplay = document.getElementById('energy-yield-display');
const thermalRadiusDisplay = document.getElementById('thermal-radius-display');
const damageSummaryContainer = document.getElementById('damage-summary-container');
const asteroidSelect = document.getElementById('asteroid-select');
const apiStatusDisplay = document.getElementById('api-status');

const torinoScaleDisplay = document.getElementById('torino-scale');
const potentialYearsDisplay = document.getElementById('potential-years');
const sentryNeoNameDisplay = document.getElementById('sentry-neo-name');
const fireballButton = document.getElementById('fireball-button');
const fireballApiButton = document.getElementById('fireball-api-button');
const shareButton = document.getElementById('share-button');

const arLaunchButton = document.getElementById('ar-launch-button');

const fireballStatusDisplay = document.getElementById('fireball-status');

const economicDamageDisplay = document.getElementById('economic-damage');
const humanFatalitiesDisplay = document.getElementById('human-fatalities');

const fireballModal = document.getElementById('fireball-modal');
const apodModalStatus = document.getElementById('apod-modal-status');
const apodContentContainer = document.getElementById('apod-content-container');
const tooltipBox = document.getElementById('tooltip-box');

const today = new Date();
const formatDate = (date) => date.toISOString().split('T')[0];

const calculateFixedDateRange = (startOffsetDays, rangeDays = 7) => {
    const start = new Date(today);
    start.setDate(today.getDate() + startOffsetDays);

    const end = new Date(start);
    end.setDate(start.getDate() + rangeDays);

    return {
        startDate: formatDate(start),
        endDate: formatDate(end)
    };
};

const fetchAsteroidDataRange = async (startDate, endDate) => {
    const url = `${NEO_API_BASE_URL}?start_date=${startDate}&end_date=${endDate}&api_key=${NASA_API_KEY}`;

    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                if (response.status === 429 && i < maxRetries - 1) {
                    const delay = Math.pow(2, i) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data;

        } catch (error) {
            console.error(`Error fetching NASA NEO data for ${startDate}:`, error);
            return null;
        }
    }
};

const fetchMultipleAsteroidData = async () => {
    const searchWindows = [
        calculateFixedDateRange(0, 7),
        calculateFixedDateRange(60, 7),
        calculateFixedDateRange(300, 7)
    ];

    apiStatusDisplay.textContent = `Searching 3 fixed windows for relevant NEOs...`;
    asteroidSelect.innerHTML = `<option value="" disabled selected>Loading PHAs from NASA...</option>`;

    let allAsteroids = [];

    for (const { startDate, endDate } of searchWindows) {
        const rawData = await fetchAsteroidDataRange(startDate, endDate);
        if (rawData) {
            const newAsteroids = processNasaData(rawData);
            allAsteroids.push(...newAsteroids);
        }
    }

    const uniqueAsteroidIds = new Set(allAsteroids.map(a => a.id));
    asteroidData = Array.from(uniqueAsteroidIds).map(id =>
        allAsteroids.find(a => a.id === id)
    );

    populateAsteroidSelector();

    if (asteroidData.length > 0) {
        apiStatusDisplay.textContent = `Search complete. Loaded ${asteroidData.length} relevant NEOs from all windows.`;
        asteroidSelect.value = asteroidData[0].id;
        asteroidSelect.dispatchEvent(new Event('change'));
    } else {
        apiStatusDisplay.textContent = `Search complete. No PHAs (10-100m) found in the fixed windows.`;
    }
};


const processNasaData = (data) => {
    const processed = [];
    if (!data.near_earth_objects) return processed;
    const dates = Object.keys(data.near_earth_objects).sort();

    for (const date of dates) {
        data.near_earth_objects[date].forEach(neo => {
            if (neo.is_potentially_hazardous_asteroid) {
                const closeApproach = neo.close_approach_data.find(cad => cad.orbiting_body === "Earth");

                if (closeApproach && neo.estimated_diameter && neo.estimated_diameter.meters) {
                    const minDiameter = neo.estimated_diameter.meters.estimated_diameter_min;
                    const velocity = parseFloat(closeApproach.relative_velocity.kilometers_per_second);

                    if (minDiameter >= 10 && minDiameter <= 100) {
                        processed.push({
                            id: neo.id,
                            name: neo.name,
                            date: date,
                            diameter: minDiameter,
                            velocity: velocity,
                            is_pha: neo.is_potentially_hazardous_asteroid
                        });
                    }
                }
            }
        });
    }
    return processed;
};

const populateAsteroidSelector = () => {
    isApiDataSelected = false;
    asteroidSelect.innerHTML = `<option value="" disabled selected>Select a Potentially Hazardous NEO</option>`;

    const defaultNeo = {
        id: 'custom-sim',
        name: 'Impactor-2025 (Custom Sim)',
        date: formatDate(today),
        diameter: 50,
        velocity: 20,
        is_pha: true
    };

    const defaultOption = document.createElement('option');
    defaultOption.value = defaultNeo.id;
    defaultOption.textContent = `${defaultNeo.name} (50m, Default)`;
    defaultOption.dataset.diameter = defaultNeo.diameter.toFixed(0);
    defaultOption.dataset.velocity = defaultNeo.velocity.toFixed(1);
    defaultOption.dataset.name = defaultNeo.name;
    asteroidSelect.appendChild(defaultOption);

    if (asteroidData.length > 0) {
        asteroidData.forEach(neo => {
            const option = document.createElement('option');
            option.value = neo.id;
            option.textContent = `${neo.name} (${neo.diameter.toFixed(0)}m, ${neo.date})`;
            option.dataset.diameter = neo.diameter.toFixed(0);
            option.dataset.velocity = neo.velocity.toFixed(1);
            option.dataset.name = neo.name;
            asteroidSelect.appendChild(option);
        });

        asteroidSelect.value = asteroidData[0].id;
    } else {
        apiStatusDisplay.textContent = `Search complete. Only the default simulation is available.`;
    }

    asteroidSelect.dispatchEvent(new Event('change'));
};

const getSimulatedSentryRisk = (neoName, diameter) => {
    let torino = 0;
    let years = "None";

    if (diameter >= 50) {
        torino = 2;
        years = `${today.getFullYear() + 5}, ${today.getFullYear() + 10}`;
    } else if (diameter >= 20) {
        torino = 1;
        years = `${today.getFullYear() + 1}`;
    } else {
        torino = 0;
    }

    if (neoName.includes('Custom Sim')) {
        years = years === "None" ? "N/A (Synthetic)" : years + " (Synthetic)";
    }

    return { torino, years };
}

const calculateSocioEconomicImpact = (severeDamageCount, damageRadiusMeters, thermalRadiusMeters) => {
    const energyYield = parseFloat(energyYieldDisplay.textContent) || 0;
    const diameter = parseFloat(diameterInput.value);
    const velocity = parseFloat(velocityInput.value);

    let estimatedDamage = 0;

    const baseDamageFloor = 5000000 * Math.pow(energyYield, 0.75);

    estimatedDamage += severeDamageCount * MOCK_BUILDING_VALUE_USD;

    const windowDamageRadiusMeters = damageRadiusMeters > 0 ? damageRadiusMeters * 1.5 : 500;
    const windowDamageAreaSqKm = Math.PI * Math.pow(windowDamageRadiusMeters / 1000, 2);
    const affectedBuildingsForWindows = Math.round(windowDamageAreaSqKm * MOCK_POP_DENSITY_SQKM * 0.1);
    estimatedDamage += affectedBuildingsForWindows * MOCK_WINDOW_DAMAGE_COST;

    estimatedDamage = Math.max(estimatedDamage, baseDamageFloor);

    if (diameter < 15 && velocity < 14) {
        estimatedDamage = Math.min(estimatedDamage, 4999);
    } else if (diameter >= 15 && estimatedDamage < 10000) {
        estimatedDamage = 10000;
    }

    const formattedDamage = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0
    }).format(estimatedDamage);

    let estimatedFatalities = 0;
    const shockAreaSqKm = Math.PI * Math.pow(damageRadiusMeters / 1000, 2);
    const thermalAreaSqKm = Math.PI * Math.pow(thermalRadiusMeters / 1000, 2);

    estimatedFatalities += Math.round(shockAreaSqKm * MOCK_POP_DENSITY_SQKM * CASUALTY_RATE_STRUCTURAL);

    const thermalFatalityMultiplier = Math.pow(thermalAreaSqKm, 0.7) * (MOCK_POP_DENSITY_SQKM / 10000);
    estimatedFatalities += Math.round(thermalFatalityMultiplier * 10 * CASUALTY_RATE_THERMAL_MINOR);

    const baseEnergyFatality = Math.round(50 * Math.pow(energyYield, 0.8));
    estimatedFatalities = Math.max(estimatedFatalities, baseEnergyFatality);

    estimatedFatalities = Math.min(Math.max(estimatedFatalities, 10), 500);

    return { formattedDamage, estimatedFatalities };
};



const fetchAPODData = async () => {
    apodModalStatus.textContent = "Fetching today's Astronomy Picture of the Day (APOD)...";
    apodContentContainer.innerHTML = '';

    const url = `${APOD_API_URL}?api_key=${NASA_API_KEY}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        if (data.url) {
            showAPODData(data);
        } else {
            apodModalStatus.textContent = "APOD data unavailable for today.";
        }
    } catch (error) {
        console.error("Error fetching APOD data:", error);
        apodModalStatus.textContent = `Error fetching data: ${error.message}. Try again later.`;
    }
};

const showAPODData = (data) => {
    apodModalStatus.textContent = `Date: ${data.date}`;

    let contentHTML = `<h4 style="font-size: 1.125rem; font-weight: bold; margin-bottom: 0.5rem; color: var(--color-yellow-primary);">${data.title}</h4>`;

    if (data.media_type === 'image') {
        contentHTML += `<img src="${data.url}" alt="${data.title}" style="max-width: 100%; height: auto; border-radius: 0.5rem; margin-bottom: 1rem;" onerror="this.onerror=null;this.src='https://placehold.co/600x400/1f2937/9ca3af?text=Image+Load+Error';">`;
    } else if (data.media_type === 'video') {
        contentHTML += `<p>Video Content (Cannot display full iframe content in this simulator): <a href="${data.url}" target="_blank" style="color: var(--color-purple-light);">Watch on NASA Site</a></p>`;
    }

    contentHTML += `<p>${data.explanation}</p>`;

    if (data.copyright) {
        contentHTML += `<p style="font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 1rem;">Credit: ${data.copyright}</p>`;
    }

    apodContentContainer.innerHTML = contentHTML;
};


const clearFireballMarkers = () => {
    fireballMarkers.forEach(marker => scene.remove(marker));
    fireballMarkers = [];
};

const plotHistoricalFireballs = () => {
    if (fireballMarkers.length > 0) {
        clearFireballMarkers();
        fireballStatusDisplay.textContent = "Historical airburst visualization cleared.";
        return;
    }

    const markerRadius = 50;

    HISTORICAL_FIREBALLS.forEach(fireball => {
        const yPos = fireball.altitude * 1000;

        const geometry = new THREE.SphereGeometry(markerRadius, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: fireball.color, transparent: true, opacity: 0.9 });
        const marker = new THREE.Mesh(geometry, material);

        marker.position.set(
            (Math.random() - 0.5) * 500,
            yPos,
            (Math.random() - 0.5) * 500
        );

        scene.add(marker);
        fireballMarkers.push(marker);
    });

    fireballStatusDisplay.textContent = `Plotted ${fireballMarkers.length} historical airburst events for comparison.`;
};


const updateSentryDisplay = (neoName, sentryData) => {
    sentryNeoNameDisplay.textContent = `NEO: ${neoName}`;
    torinoScaleDisplay.textContent = sentryData.torino;
    potentialYearsDisplay.textContent = sentryData.years;

    let torinoColor = 'var(--color-green-summary-text)';
    if (sentryData.torino > 0 && sentryData.torino <= 4) {
        torinoColor = 'var(--color-yellow-primary)';
    } else if (sentryData.torino > 4) {
        torinoColor = 'var(--color-red-primary)';
    }
    torinoScaleDisplay.style.color = torinoColor;
}



const calculateAirburst = (D_m, V_km_s, Angle_deg) => {
    const V_m_s = V_km_s * 1000;
    const Angle_rad = (Angle_deg * Math.PI) / 180;
    const Mass_kg = (4 / 3) * Math.PI * Math.pow(D_m / 2, 3) * DEFAULT_DENSITY_KG_M3;

    let altitude_km = 40;

    if (Mass_kg > 1e7) {
        altitude_km = 10;
    } else if (Mass_kg > 1e6) {
        altitude_km = 15;
    } else {
        altitude_km = 20 + 20 * Math.sin(Angle_rad);
    }

    const energyJoules = 0.5 * Mass_kg * Math.pow(V_m_s, 2);
    const tnt_megatons = energyJoules / JOULES_TO_MEGATONS;

    return {
        altitude_km: Math.max(5, altitude_km),
        tnt_megatons: Math.max(0.01, tnt_megatons)
    };
};

const calculateOverpressure = (R_m, H_m, E_mt) => {
    if (E_mt <= 0) return 0;

    const burstDistance_m = Math.sqrt(R_m * R_m + H_m * H_m);
    const basePressure = 1000 * Math.pow(E_mt, 0.5);
    let pressure = basePressure / Math.pow(burstDistance_m, 1.5);

    return Math.max(0, Math.min(100, pressure * 1000));
};

const calculateThermalRadius = (E_mt, Burn_cal_cm2) => {
    return 2500 * Math.pow(E_mt, 0.5) * Math.sqrt(10 / Burn_cal_cm2);
};



const updateCameraPosition = () => {
    const phiRad = (90 - phi) * Math.PI / 180;
    const thetaRad = theta * Math.PI / 180;
    phi = Math.max(orbitClampMin, Math.min(orbitClampMax, phi));
    camera.position.x = cameraRadius * Math.sin(phiRad) * Math.cos(thetaRad);
    camera.position.y = cameraRadius * Math.cos(phiRad);
    camera.position.z = cameraRadius * Math.sin(phiRad) * Math.sin(thetaRad);
    camera.lookAt(0, 0, 0);
};

const dragStart = (event) => {
    isDragging = true;
    canvasContainer.style.cursor = 'grabbing';
    previousMousePosition.x = event.clientX || event.touches[0].clientX;
    previousMousePosition.y = event.clientY || event.touches[0].clientY;
};

const dragEnd = () => {
    isDragging = false;
    canvasContainer.style.cursor = 'grab';
};

const dragMove = (event) => {
    if (!isDragging) return;
    if (event.touches) event.preventDefault();

    const clientX = event.clientX || event.touches[0].clientX;
    const clientY = event.clientY || event.touches[0].clientY;

    const deltaX = clientX - previousMousePosition.x;
    const deltaY = clientY - previousMousePosition.y;

    theta -= deltaX * orbitSpeed * 0.1;
    phi -= deltaY * orbitSpeed * 0.1;

    updateCameraPosition();

    previousMousePosition.x = clientX;
    previousMousePosition.y = clientY;
};

const handleZoom = (event) => {
    event.preventDefault();
    cameraRadius += event.deltaY * 5;
    cameraRadius = Math.max(500, Math.min(6000, cameraRadius));
    updateCameraPosition();
};



const initThreeJS = () => {
    const width = canvasContainer.clientWidth;
    const height = canvasContainer.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1117);

    camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 10000);
    cameraRadius = 3000;
    theta = 225;
    phi = 45;
    updateCameraPosition();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    canvasContainer.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(2000, 3000, 2000);
    scene.add(dirLight);

    const groundGeometry = new THREE.PlaneGeometry(CITY_SIZE * 4, CITY_SIZE * 4);
    const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x1a472a, side: THREE.DoubleSide });
    const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    groundPlane.rotation.x = Math.PI / 2;
    scene.add(groundPlane);

    const gridHelper = new THREE.GridHelper(CITY_SIZE * 4, 20, 0x54d454, 0x54d454);
    gridHelper.position.y = 1;
    scene.add(gridHelper);

    for (let i = 0; i < BUILDING_COUNT; i++) {
        const width = Math.random() * 50 + 10;
        const depth = Math.random() * 50 + 10;
        const height = Math.random() * 150 + 30;

        const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
        const buildingMaterial = new THREE.MeshLambertMaterial({ color: 0x4b5563 });
        const building = new THREE.Mesh(buildingGeometry, buildingMaterial);

        building.position.x = (Math.random() - 0.5) * CITY_SIZE * 2;
        building.position.z = (Math.random() - 0.5) * CITY_SIZE * 2;
        building.position.y = height / 2;

        building.userData = {
            initialColor: buildingMaterial.color.getHex(),
            maxOverpressure: 0,
            resilience: height / 200,
            damageThreshold: BUILDING_DAMAGE_THRESHOLD_PSI * (1 + (height / 500))
        };

        scene.add(building);
        buildings.push(building);
    }


    const thermalGeometry = new THREE.RingGeometry(0, 1, 64);
    const thermalMaterial = new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    thermalMesh = new THREE.Mesh(thermalGeometry, thermalMaterial);
    thermalMesh.rotation.x = Math.PI / 2;
    thermalMesh.position.y = 2;
    scene.add(thermalMesh);

    const shockGeometry = new THREE.RingGeometry(0, 1, 64);
    const shockMaterial = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.1, side: THREE.DoubleSide });
    shockwaveMesh = new THREE.Mesh(shockGeometry, shockMaterial);
    shockwaveMesh.rotation.x = Math.PI / 2;
    scene.add(shockwaveMesh);

    const markerGeometry = new THREE.SphereGeometry(100, 16, 16);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    burstMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    scene.add(burstMarker);

    renderer.domElement.addEventListener('mousedown', dragStart);
    renderer.domElement.addEventListener('touchstart', dragStart);
    renderer.domElement.addEventListener('mouseup', dragEnd);
    renderer.domElement.addEventListener('touchend', dragEnd);
    renderer.domElement.addEventListener('mousemove', dragMove);
    renderer.domElement.addEventListener('touchmove', dragMove);
    renderer.domElement.addEventListener('wheel', handleZoom);

    const animate = () => {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    };
    animate();

    window.addEventListener('resize', () => {
        const width = canvasContainer.clientWidth;
        const height = canvasContainer.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    });
};

const updateThreeDVisualization = (altitude, thermalRadius, damageRadius, energyYield) => {

    burstMarker.position.y = altitude * 1000;

    thermalMesh.scale.set(thermalRadius, thermalRadius, 1);

    shockwaveMesh.scale.set(damageRadius, damageRadius, 1);

    buildings.forEach(building => {
        const distance_m = Math.sqrt(
            building.position.x * building.position.x +
            building.position.z * building.position.z
        );

        const pressure = calculateOverpressure(distance_m, altitude * 1000, energyYield);
        building.userData.maxOverpressure = pressure;

        const color = new THREE.Color();

        if (pressure > building.userData.damageThreshold) {
            color.set(0xdc2626);
        } else if (pressure > 1.0) {
            color.set(0xfb923c);
        } else {
            color.set(building.userData.initialColor);
        }

        building.material.color.lerp(color, 0.5);
    });
};

const updateSummary = (burstAltitude, energyYield, thermalRadius, severeDamageCount, maxDamageRadius) => {
    burstAltitudeDisplay.textContent = burstAltitude.toFixed(1);
    energyYieldDisplay.textContent = energyYield.toFixed(2);
    thermalRadiusDisplay.textContent = thermalRadius.toFixed(0);

    const windowDamageCount = buildings.filter(b => b.userData.maxOverpressure > 1.0 && b.userData.maxOverpressure <= b.userData.damageThreshold).length;

    let damageText;
    let colorClass;

    if (severeDamageCount > 0) {
        damageText = `SEVERE DAMAGE: ${severeDamageCount} structures collapsed (Overpressure > ${BUILDING_DAMAGE_THRESHOLD_PSI} PSI).`;
        colorClass = "summary-red";
    } else if (windowDamageCount > 0) {
        damageText = `MODERATE DAMAGE: ${windowDamageCount} structures affected (Window Shattering).`;
        colorClass = "summary-yellow";
    } else {
        damageText = "LOW IMPACT: Primarily thermal flash risk. Structures mostly intact.";
        colorClass = "summary-green";
    }

    const { formattedDamage, estimatedFatalities } = calculateSocioEconomicImpact(severeDamageCount, maxDamageRadius, thermalRadius);
    economicDamageDisplay.textContent = "≈" + formattedDamage;
    humanFatalitiesDisplay.textContent = estimatedFatalities.toLocaleString() + "±";

    damageSummaryContainer.innerHTML = `
                <div class="damage-summary-box ${colorClass}">
                    ${damageText}
                </div>
            `;
};


const runSimulation = () => {
    const D_m = parseFloat(diameterInput.value);
    const V_km_s = parseFloat(velocityInput.value);
    const Angle_deg = parseFloat(angleInput.value);

    diameterValueDisplay.textContent = D_m.toFixed(0);
    velocityValueDisplay.textContent = V_km_s.toFixed(1);
    angleValueDisplay.textContent = Angle_deg.toFixed(0);

    const selectedOption = asteroidSelect.options[asteroidSelect.selectedIndex];
    const neoName = selectedOption && selectedOption.dataset.name ? selectedOption.dataset.name : "Custom Simulation";
    const diameter = parseFloat(diameterInput.value);

    const sentryData = getSimulatedSentryRisk(neoName, diameter);
    updateSentryDisplay(neoName, sentryData);

    const { altitude_km, tnt_megatons } = calculateAirburst(D_m, V_km_s, Angle_deg);
    const altitude = parseFloat(altitude_km);
    const energyYield = parseFloat(tnt_megatons);

    const thermalRadius = calculateThermalRadius(energyYield, 8);
    let maxDamageRadius = 0;
    const H_m = altitude * 1000;

    for (let r = 1; r < SHOCKWAVE_MAX_RADIUS_M; r += 10) {
        const pressure = calculateOverpressure(r, H_m, energyYield);
        if (pressure > BUILDING_DAMAGE_THRESHOLD_PSI) {
            maxDamageRadius = r;
        } else if (maxDamageRadius > 0) {
            break;
        }
    }

    currentMaxDamageRadiusM = maxDamageRadius;

    let severeDamageCount = 0;
    buildings.forEach(building => {
        const distance_m = Math.sqrt(
            building.position.x * building.position.x +
            building.position.z * building.position.z
        );
        const pressure = calculateOverpressure(distance_m, altitude * 1000, energyYield);
        if (pressure > building.userData.damageThreshold) {
            severeDamageCount++;
        }
    });

    updateThreeDVisualization(altitude, thermalRadius, maxDamageRadius, energyYield);
    updateSummary(altitude, energyYield, thermalRadius, severeDamageCount, maxDamageRadius);
};

const handleAsteroidSelect = (event) => {
    const selectedOption = event.target.options[event.target.selectedIndex];

    if (selectedOption && selectedOption.dataset.diameter) {

        const diameter = parseFloat(selectedOption.dataset.diameter);
        const velocity = parseFloat(selectedOption.dataset.velocity);

        diameterInput.value = diameter;
        velocityInput.value = velocity;

        const isCustomSim = selectedOption.value === 'custom-sim';
        diameterInput.disabled = !isCustomSim;
        velocityInput.disabled = !isCustomSim;

        angleInput.disabled = false;

        runSimulation();
    }
};



const inputs = [diameterInput, velocityInput, angleInput];
inputs.forEach(input => input.addEventListener('input', runSimulation));

asteroidSelect.addEventListener('change', handleAsteroidSelect);
fireballButton.addEventListener('click', plotHistoricalFireballs);

fireballApiButton.addEventListener('click', () => {
    fireballModal.style.display = 'flex';
    fetchAPODData();
});

const launchARView = () => {
    const AR_SCALE_FACTOR = 10000;

    const burstAltitudeKm = parseFloat(burstAltitudeDisplay.textContent) || 0;
    const thermalRadiusM = parseFloat(thermalRadiusDisplay.textContent) || 0;
    const maxDamageRadiusM = currentMaxDamageRadiusM; // Use the globally stored value

    if (burstAltitudeKm === 0 || maxDamageRadiusM === 0) {
        alert("Please run a simulation first (adjust sliders or select NEO) before launching AR view.");
        return;
    }
    const arModal = document.getElementById('ar-modal');
    const arBurst = document.getElementById('ar-burst-marker');
    const arThermal = document.getElementById('ar-thermal-ring');
    const arShockwave = document.getElementById('ar-shockwave-ring');
    const arLabel = document.getElementById('ar-label');

    const arAltitude = (burstAltitudeKm * 1000) / AR_SCALE_FACTOR;
    const arThermalRadius = thermalRadiusM / AR_SCALE_FACTOR;
    const arShockwaveRadius = maxDamageRadiusM / AR_SCALE_FACTOR;

    const neoName = asteroidSelect.options[asteroidSelect.selectedIndex].dataset.name;

    arLabel.setAttribute('value', `${neoName}\nAltitude: ${burstAltitudeKm.toFixed(1)} km`);
    arBurst.setAttribute('position', `0 ${arAltitude.toFixed(3)} -1`);
    arThermal.setAttribute('radius-outer', arThermalRadius.toFixed(3));
    arShockwave.setAttribute('radius-outer', arShockwaveRadius.toFixed(3));

    const isHazard = arShockwaveRadius > 0.001 || arThermalRadius > 0.01;
    arThermal.setAttribute('visible', isHazard);
    arShockwave.setAttribute('visible', isHazard);

    arModal.style.display = 'flex';

    const sceneEl = document.getElementById('ar-scene');
    if (sceneEl.getAttribute('ar-modes') && sceneEl.enterAR) {
        sceneEl.enterAR();
    }
};

arLaunchButton.addEventListener('click', launchARView);
const shareSimulationResults = async () => {

    const selectedOption = asteroidSelect.options[asteroidSelect.selectedIndex];
    const neoName = selectedOption && selectedOption.dataset.name ? selectedOption.dataset.name : "Custom Simulation";

    const message = `--- Atmosphere Shield Simulation Results ---\n\n` +
        `NEO: ${neoName}\n\n` +

        `[Airburst Prediction]\n` +
        `• Diameter: ${diameterValueDisplay.textContent}m\n` +
        `• Velocity: ${velocityValueDisplay.textContent} km/s\n` +
        `• Angle: ${angleValueDisplay.textContent}°\n\n` +

        `[Catastrophe Impact & Casualty]\n` +
        `• Damage: ${economicDamageDisplay.textContent}\n` +
        `• Fatalities: ${humanFatalitiesDisplay.textContent}\n\n` +

        `[Sentry Risk Assessment]\n` +
        `• Torino Scale: ${torinoScaleDisplay.textContent}\n` +
        `• Potential Impact Years: ${potentialYearsDisplay.textContent}\n` +
        `Check out https://aadithyandd.github.io/uromet/ for simulating such predictions!\n`;

    let files = [];

    try {
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');

        const response = await fetch(dataUrl);
        const blob = await response.blob();

        files.push(new File([blob], 'airburst_simulation.png', { type: 'image/png' }));

    } catch (error) {
        console.error("Failed to capture canvas image for sharing:", error);
    }

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Atmosphere Shield Simulation Results',
                text: message,
            });
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error sharing:', error);
                alert(`Sharing failed or was interrupted. Message: ${message}`);
            }
        }
    } else {
        const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
        window.open(tweetUrl, '_blank');
    }
};

shareButton.addEventListener('click', shareSimulationResults);
function showTooltip(event, title, content) {
    tooltipBox.innerHTML = `<span class="tooltip-title">${title}</span>${content}`;
    tooltipBox.style.display = 'block';
    moveTooltip(event);
}

function moveTooltip(event) {
    if (tooltipBox.style.display === 'block') {
        let x = event.clientX + 15;
        let y = event.clientY + 15;

        const viewportWidth = window.innerWidth;
        const boxWidth = tooltipBox.offsetWidth;
        if (x + boxWidth > viewportWidth) {
            x = viewportWidth - boxWidth - 10;
        }

        tooltipBox.style.left = `${x}px`;
        tooltipBox.style.top = `${y}px`;
    }
}

function hideTooltip() {
    tooltipBox.style.display = 'none';
}

const initialLoad = () => {
    initThreeJS();
    fetchMultipleAsteroidData();
};

window.onload = initialLoad;

function cityData() {
    alert(`
        Mcok City Simulation Data:
        - Area: ${CITY_SIZE}m x ${CITY_SIZE}m
        - Buildings: ${BUILDING_COUNT}
        - Building Value: $${MOCK_BUILDING_VALUE_USD.toLocaleString()} each
        - Population Density: ${MOCK_POP_DENSITY_SQKM.toLocaleString()} people/km²
        - Window Damage Cost: $${MOCK_WINDOW_DAMAGE_COST.toLocaleString()} each
        - Casualty Rates:
          • Structural Collapse: ${CASUALTY_RATE_STRUCTURAL * 100}%
          • Thermal Minor Burns: ${CASUALTY_RATE_THERMAL_MINOR * 100}%
    `);
}

function runsim() {
    window.scrollTo(0, 1300);
}
function news() {
    window.open('https://www.nasa.gov/news/recently-published/', '_blank');
}
function contact() {
    alert(
        `Contact Information:
        - Email: ondago.team@gmail.com
        - Website: under develpoment 
        - Personal:
            • LinkedIn [A Aditya Nair]: https://www.linkedin.com/in/adifications/
            • LinkedIn [Aadithyan.D]: https://www.linkedin.com/in/aadithyandd/`
    )
}
function about() {
    alert(
        `About Uromet:
        Uromet is a web based simulation tool designed to model the potential impact of Near-Earth Objects (NEOs) entering Earth's atmosphere. By leveraging data from NASA's APIs, it provides users with insights into airburst phenomena, potential damage assessments, and socio economic impacts.`
    )
}
function ondgo() {
    window.open('https://www.instagram.com/ondago.team', '_blank');
}
const navbar = document.getElementById('navbar');
const hideThreshold = 200; // Scroll position (in pixels) to fully hide the bar
let isHidden = false;
let isTicking = false;

function updateScrollState() {
    const currentScroll = window.scrollY || document.documentElement.scrollTop;

    if (currentScroll > hideThreshold) {
        if (!isHidden) {
            navbar.classList.add('navbar-hidden');
            isHidden = true;
        }
    } else {
        if (isHidden) {
            navbar.classList.remove('navbar-hidden');
            isHidden = false;
        }
    }

    isTicking = false;
}

window.addEventListener('scroll', () => {
    if (!isTicking) {
        window.requestAnimationFrame(updateScrollState);
        isTicking = true;
    }
});
document.addEventListener('DOMContentLoaded', () => {

    const firstVisitKey = 'neo_first_visit';
    const welcomeOverlay = document.getElementById('welcome-overlay');
    const closeWelcomeBtn = document.getElementById('close-welcome');

    if (!localStorage.getItem(firstVisitKey)) {
        setTimeout(() => {
            welcomeOverlay.classList.add('visible');
        }, 500);

        closeWelcomeBtn.addEventListener('click', () => {
            welcomeOverlay.classList.remove('visible');
            localStorage.setItem(firstVisitKey, 'true');
        });
    } else {
        welcomeOverlay.style.display = 'none';
    }
});
function cleardata() {
    if (confirm("Are you sure you want to clear all stored data? This action cannot be undone.")) {
        alert("All stored data has been cleared.");
        localStorage.clear();
        window.location.reload();
        window.scrollTo(0, 0);
    } else {
        alert("Data clearance canceled.");
    }

}

