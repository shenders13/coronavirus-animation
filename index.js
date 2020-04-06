// ---------------------------------------------
// ------------- Define variables --------------
// ---------------------------------------------

const width = window.innerWidth > 1668 ? 834 : window.innerWidth / 2; // svg width
const height = width; // svg height
const circleRadii = 5; // circle radius
const homeSize = 60; // home square length size
const interval = 1000; // how long it takes between "next steps"
const daysInOneInterval = 1; // one step = 1day
const daysInfectionLast = 14; // how many days it takes to "recover"
const deathRate = 0.03; // what percent of infected persons die.
const avgNumPeoplePerHome = 2; // Avg number of people in each home
const avgNumOfVisitsPerWeek = 2; // For naughty people, how often do they travel
const fractionOfPeopleTravelling = 0.5; // Max 1, Min 0.
const partnerTransmissionRate = 0.9;
const incubationPeriodInDays = 7; // How long before you get symptoms. After this you self quarentine and don't pass it on.
const roommateTransmissionRate = 0.1 / 7;
const initiallySick = 0.2; // percentage initially sick

const SLIDER_VALUES = {
  numHomes: 12,
  avgNumPartnersPerPerson: 2,
  avgNumOfVisitsPerWeek: 1,
  fractionOfPeopleTravelling: 0.5,
};

const intervalsSicknessLasts = daysInfectionLast / daysInOneInterval;
const incubationPeriodsInIntervals = Math.floor(
  incubationPeriodInDays / daysInOneInterval
);

let homeCount = 0; // used for id generation
let personCount = 0; // used for id generation

const statuses = {
  healthy: {
    name: "Healthy",
    color: "#3ecf8e",
  },
  sick: {
    name: "Sick",
    color: "#fe6d78",
  },
  recovered: {
    name: "Recovered",
    color: "#00a0e1",
  },
  deceased: {
    name: "Deceased",
    color: "black",
  },
};

const animationStates = {
  initial: "INITIAL",
  paused: "PAUSED",
  running: "RUNNING",
};

// ---------------------------------------------
// --------------- DOM Elements ----------------
// ---------------------------------------------

const svg = d3
  .select("#animation")
  .append("svg")
  .attr("id", "animation")
  .attr("width", width)
  .attr("height", height);

const timerElement = document.getElementById("time-elapsed");

const healthyCounterElement = document.getElementById("healthy");
const sickCounterElement = document.getElementById("sick");
const recoveredCounterElement = document.getElementById("recovered");
const deceasedCounterElement = document.getElementById("deceased");
const startOrPauseButton = document.getElementById("start-or-pause");
const resetButton = document.getElementById("reset");
const sliderElements = document.getElementsByClassName("slider");
const populationElement = document.getElementById("population");
const travellersElement = document.getElementById("travellers");
const initiallySickElement = document.getElementById("initiallySick");
const couplesElement = document.getElementById("couples");

// ---------------------------------------------
// ----------------- Classes -------------------
// ---------------------------------------------

class PartnerStore {
  constructor() {
    this.partners = {};
  }

  partnerCount = () => {
    const nestedArrays = Object.values(this.partners);
    const flatArray = [];
    nestedArrays.forEach((nestedArray) => {
      flatArray.push(...nestedArray);
    });
    return flatArray.length / 2;
  };

  eraseAllPartnerships = () => {
    this.partners = {};
  };

  getPartners = (person) => {
    return this.partners[person.id] || [];
  };

  savePartnership = (personA, personB) => {
    const personAPartners = this.getPartners(personA);
    const personBPartners = this.getPartners(personB);

    const addToPersonAPartners = !personAPartners.find(
      (p) => p.id === personB.id
    );
    const addToPersonBPartners = !personBPartners.find(
      (p) => p.id === personA.id
    );

    if (addToPersonAPartners) {
      this.partners[personA.id] = [...personAPartners, personB];
    }

    if (addToPersonBPartners) {
      this.partners[personB.id] = [...personBPartners, personA];
    }
  };

  suggestNewPartners = (person, allPersons) => {
    if (!person.travels || person.isDeceased) {
      return [];
    }
    const existingPartners = this.getPartners(person);
    const newGeneratedPartners = findNewPartnersForPerson(
      person,
      allPersons,
      existingPartners
    );
    return newGeneratedPartners;
  };
}

class Home {
  constructor(svg, x, y, partnersStore) {
    this.svg = svg;
    this.x = x;
    this.y = y;
    homeCount++;
    this.id = `home-id-${homeCount}`;
    this.persons = [];
    this.partnersStore = partnersStore;
    this.drawSquare();
  }

  personsHomeCoordinates = () => {
    const xVal =
      this.x + randomIntFromInterval(-0.3 * homeSize, 0.3 * homeSize);
    const yVal =
      this.y + randomIntFromInterval(-0.3 * homeSize, 0.3 * homeSize);
    return { xVal, yVal };
  };

  addPeopleToHome = () => {
    const numberOfPeople = randomNumberAround(avgNumPeoplePerHome);
    for (let i = 0; i < numberOfPeople; i++) {
      const { xVal, yVal } = this.personsHomeCoordinates();
      const newPerson = new Person(
        this.svg,
        xVal,
        yVal,
        this,
        this.partnersStore
      );
      this.persons.push(newPerson);
    }
  };

  drawSquare = () => {
    this.svg
      .append("rect")
      .attr("x", this.x - 0.5 * homeSize)
      .attr("y", this.y - 0.5 * homeSize)
      .attr("rx", 8)
      .attr("width", homeSize)
      .attr("height", homeSize)
      .attr("id", this.id);
  };
}

class Animation {
  constructor(
    svg,
    partnersStore,
    chart,
    intialChartData,
    timerElement,
    healthyCounterElement,
    sickCounterElement,
    recoveredCounterElement,
    deceasedCounterElement,
    startOrPauseButton
  ) {
    this.svg = svg;
    this.homes = [];
    this.partnersStore = partnersStore;
    this.chart = chart;
    this.chartValues = intialChartData;
    this.timeInDays = 0;
    this.timerElement = timerElement;
    this.healthyCounterElement = healthyCounterElement;
    this.sickCounterElement = sickCounterElement;
    this.recoveredCounterElement = recoveredCounterElement;
    this.deceasedCounterElement = deceasedCounterElement;
    this.startOrPauseButton = startOrPauseButton;
    this.animationState = animationStates.initial;
    this.animationIntervalFn = null;
  }

  get persons() {
    return this.homes.reduce((acc, h) => {
      return [...acc, ...h.persons];
    }, []);
  }

  assignPartners = () => {
    this.partnersStore.eraseAllPartnerships();
    const allPersons = this.persons;
    allPersons.forEach((p) => {
      const newSuggestedPartners = this.partnersStore.suggestNewPartners(
        p,
        allPersons
      );
      newSuggestedPartners.forEach((newPartner) => {
        this.partnersStore.savePartnership(p, newPartner);
      });
    });
  };

  createHomes = (numHomes) => {
    const angularSeperationBetweenHomes = 360 / numHomes;
    for (let i = 0; i < numHomes; i++) {
      const homeX =
        width / 2 +
        0.4 * width * Math.sin(degToRad(angularSeperationBetweenHomes * i));
      const homeY =
        height / 2 -
        0.4 * height * Math.cos(degToRad(angularSeperationBetweenHomes * i));
      const home = new Home(this.svg, homeX, homeY, this.partnersStore);
      this.homes.push(home);
    }
    this.homes.forEach((home) => {
      // Do this after all the homes are painted otherwise the dots can get painted
      // "under" a home.
      home.addPeopleToHome();
    });
  };

  updateTimer = () => {
    this.timeInDays += daysInOneInterval;
    this.timerElement.innerHTML = this.timeInDays;
  };

  disableSliders = () => {
    resetButton.style.display = "inline";
    for (let i = 0; i < sliderElements.length; i++) {
      sliderElements[i].disabled = true;
      sliderElements[i].style.cursor = "not-allowed";
    }
  };

  displaySimulationParams = () => {
    const allPersons = this.persons;
    populationElement.innerHTML = `${allPersons.length} people`;
    travellersElement.innerHTML = `${
      allPersons.filter((p) => p.travels).length
    } rule breakers`;
    initiallySickElement.innerHTML = `${
      allPersons.filter((p) => p.isSick).length
    } sick people`;
    couplesElement.innerHTML = `${this.partnersStore.partnerCount()} couples`;
  };

  startAnimation = () => {
    this.disableSliders();
    this.createHomes(SLIDER_VALUES.numHomes);
    this.assignPartners();
    this.displaySimulationParams();
    this.continueAnimation();
  };

  toggleAnimation = () => {
    if (this.animationState === animationStates.initial) {
      this.startAnimation();
      return;
    }
    if (this.animationState === animationStates.running) {
      this.pauseAnimation();
      return;
    }
    this.continueAnimation();
  };

  pauseAnimation = () => {
    this.animationState = animationStates.paused;
    this.startOrPauseButton.innerHTML = "Resume Animation";
    this.startOrPauseButton.classList.remove("pause");
    this.startOrPauseButton.classList.add("start");
    clearInterval(this.animationIntervalFn, interval);
  };

  continueAnimation = () => {
    this.animationState = animationStates.running;
    this.startOrPauseButton.innerHTML = "Pause Animation";
    this.startOrPauseButton.classList.remove("start");
    this.startOrPauseButton.classList.add("pause");
    this.animationIntervalFn = setInterval(() => {
      // Increment timer
      this.updateTimer();

      // Make each person move.
      this.persons.forEach((person) => {
        person.move();
      });

      // People trasmit the infection, recover or sadly pass away.
      this.updateHealthStatuses();

      // Update the counters which show healthy/sick/recovered/deceased counts.
      this.updateCounters();

      // Update the chart
      this.updateChart();
    }, interval);
  };

  updateChart = () => {
    const {
      healthyCount,
      sickCount,
      recoveredCount,
      deceasedCount,
    } = this.counts;
    this.chartValues = this.chartValues.map((lineGraph) => {
      let newCount = 0;
      if (lineGraph.name === statuses.healthy.name) {
        newCount = healthyCount;
      }
      if (lineGraph.name === statuses.sick.name) {
        newCount = sickCount;
      }
      if (lineGraph.name === statuses.recovered.name) {
        newCount = recoveredCount;
      }
      if (lineGraph.name === statuses.deceased.name) {
        newCount = deceasedCount;
      }
      return {
        ...lineGraph,
        dataPoints: [
          ...lineGraph.dataPoints,
          { x: this.timeInDays, y: newCount },
        ],
      };
    });
    this.chart.set("data", this.chartValues);
  };

  get counts() {
    let healthyCount = 0;
    let sickCount = 0;
    let recoveredCount = 0;
    let deceasedCount = 0;

    this.persons.forEach((person) => {
      switch (true) {
        case person.isHealthy:
          healthyCount++;
          break;
        case person.isSick:
          sickCount++;
          break;
        case person.isRecovered:
          recoveredCount++;
          break;
        case person.isDeceased:
          deceasedCount++;
          break;
      }
    });
    return {
      healthyCount,
      sickCount,
      recoveredCount,
      deceasedCount,
    };
  }

  updateCounters = () => {
    const {
      healthyCount,
      sickCount,
      recoveredCount,
      deceasedCount,
    } = this.counts;
    healthyCounterElement.innerHTML = `${healthyCount} healthy`;
    sickCounterElement.innerHTML = `${sickCount} sick`;
    recoveredCounterElement.innerHTML = `${recoveredCount} recovered`;
    deceasedCounterElement.innerHTML = `${deceasedCount} deceased`;
  };

  updateHealthStatuses = () => {
    // For each home
    this.homes.forEach((home) => {
      const peopleCurrentlyInHome = this.persons.filter(
        (p) => p.currentLocation.id === home.id
      );
      // Loop through each person in the house
      peopleCurrentlyInHome.forEach((person) => {
        // If person is sick
        if (person.isSick) {
          // Increment time spent being sick.
          person.intervalsPersonHasBeenSick++;

          // Half way through sickness -> person may die.
          const halfWayThroughSickness =
            person.intervalsPersonHasBeenSick ===
            Math.floor(intervalsSicknessLasts / 2);
          if (halfWayThroughSickness) {
            const willDie = Math.random() < deathRate;
            if (willDie) {
              person.updateStatus(statuses.deceased);
              return;
            }
          }

          // Full way through sickness -> person recovers.
          const throughSickness =
            person.intervalsPersonHasBeenSick > intervalsSicknessLasts;
          if (throughSickness) {
            person.updateStatus(statuses.recovered);
            return;
          }

          // Person make infect the partner they're visiting (higher chance).
          const partnerIsInTheSameHouse =
            !!person.currentPartner &&
            !!peopleCurrentlyInHome.find(
              (p) => p.id === person.currentPartner.id
            );
          if (partnerIsInTheSameHouse && person.currentPartner.isHealthy) {
            const makePartnerSick = Math.random() < partnerTransmissionRate;
            if (makePartnerSick) {
              person.currentPartner.updateStatus(statuses.sick);
            }
          }

          // Person may infect others in the house (lower chance).
          const healthyPeopleInHouse = peopleCurrentlyInHome.filter(
            (p) => p.isHealthy
          );

          healthyPeopleInHouse.forEach((healthyPerson) => {
            const makeOtherPersonInHouseSick =
              Math.random() < roommateTransmissionRate;
            if (makeOtherPersonInHouseSick) {
              healthyPerson.updateStatus(statuses.sick);
            }
          });
        }
      });
    });
  };
}

class Person {
  constructor(svg, startX, startY, home, partnersStore) {
    this.svg = svg;
    this.startX = startX;
    this.startY = startY;
    this.x = startX;
    this.y = startY;
    this.home = home;
    personCount++;
    this.id = `person-id-${personCount}`;
    this.status =
      Math.random() < initiallySick ? statuses.sick : statuses.healthy;
    this.intervalsPersonHasBeenSick = 0;
    this.currentPartner = null; // You're at their house, or they're at your house.
    this.currentLocation = home;
    this.assignTravels();
    this.drawCircle();
    this.partnersStore = partnersStore;
  }

  assignTravels = () => {
    this.travels = Math.random() < SLIDER_VALUES.fractionOfPeopleTravelling; // if you don't travel, you can still get visited.    this.currentLocation = home;
  };

  get partners() {
    return this.partnersStore.getPartners(this);
  }

  get isHealthy() {
    return this.status.name === "Healthy";
  }

  get isSick() {
    return this.status.name === "Sick";
  }

  get isDeceased() {
    return this.status.name === "Deceased";
  }

  get isRecovered() {
    return this.status.name === "Recovered";
  }

  get sickAndPastIncubationPeriod() {
    return (
      this.isSick &&
      this.intervalsPersonHasBeenSick > incubationPeriodsInIntervals
    );
  }

  get isAlive() {
    return !this.isDeceased;
  }

  get isHome() {
    return this.home.id === this.currentLocation.id;
  }

  get isBeingVisited() {
    return this.isHome && this.currentPartner !== null && this.isAlive;
  }

  updateStatus = (newStatus) => {
    this.status = newStatus;
    d3.select("#" + this.id).attr("fill", this.status.color);
  };

  goHome = () => {
    this.currentLocation = this.home;
    // Remove currentPartner flag for both parties.
    // TODO: Cannot set property 'currentPartner' of null
    if (this.currentPartner) {
      this.currentPartner.currentPartner = null;
    }
    this.currentPartner = null;
    this.x = this.startX;
    this.y = this.startY;
    d3.select("#" + this.id)
      .transition()
      .attr("transform", `translate(0,0)`);
  };

  goToPartnersHome = () => {
    if (this.isBeingVisited) {
      return;
    }
    if (this.sickAndPastIncubationPeriod) {
      // Once you're past the incubation period, you have symptoms so you stop travelling
      // because you know you're sick.
      return;
    }
    const freePartners = this.partners.filter((p) => !p.isBeingVisited);
    const noPartnersAreHome = freePartners.length === 0;
    if (noPartnersAreHome) {
      return;
    }
    const probabilityOfAVistThisInterval =
      (SLIDER_VALUES.avgNumOfVisitsPerWeek / 7) * daysInOneInterval;
    const rand = Math.random();
    const willTravelThisInterval = rand < probabilityOfAVistThisInterval;
    if (!willTravelThisInterval) {
      return;
    }

    const partner =
      freePartners[Math.floor(Math.random() * freePartners.length)];

    // Add currentPartner flag for both parties.
    this.currentPartner = partner;
    partner.currentPartner = this;

    const partnersHome = partner.home;
    const { xVal, yVal } = partnersHome.personsHomeCoordinates();
    const { deltaX, deltaY } = getDistanceToMove(this.x, xVal, this.y, yVal);
    this.currentLocation = partnersHome;
    this.x = xVal;
    this.y = yVal;
    d3.select("#" + this.id)
      .transition()
      .attr("transform", `translate(${deltaX}, ${deltaY})`);
  };

  move = () => {
    if (this.isDeceased || !this.travels) {
      return;
    }
    if (this.isHome) {
      this.goToPartnersHome();
      return;
    }
    this.goHome();
  };

  drawCircle = () => {
    this.svg
      .append("circle")
      .attr("cx", this.x)
      .attr("cy", this.y)
      .attr("r", circleRadii)
      .attr("fill", this.status.color)
      .attr("id", this.id);
  };
}

// ---------------------------------------------
// ----------------- Helpers -------------------
// ---------------------------------------------

const getDistanceToMove = (xStart, xEnd, yStart, yEnd) => {
  const deltaX = xEnd - xStart;
  const deltaY = yEnd - yStart;
  return { deltaX, deltaY };
};

const degToRad = (deg) => {
  return (deg * Math.PI) / 180;
};

const randomIntFromInterval = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

const randomNumberAround = (average) => {
  return Math.ceil(Math.random() * average * 2);
};

const shuffle = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[randomIndex];
    array[randomIndex] = temp;
  }
  return array;
};

const findNewPartnersForPerson = (person, allPersons, existingPartners) => {
  const currentPartnerCount = existingPartners.length;

  if (currentPartnerCount >= SLIDER_VALUES.avgNumPartnersPerPerson) {
    return []; // Don't need any more partners.
  }

  const alivePersonsFromOtherHomes = allPersons.filter(
    (p) => p.home !== person.home && !p.isDeceased
  );

  const newPartnerOptions = alivePersonsFromOtherHomes.filter((person) => {
    return !existingPartners.find(
      (existingPartner) => existingPartner.id === person.id
    );
  });

  let numberOfPartnersToAdd = randomNumberAround(
    SLIDER_VALUES.avgNumPartnersPerPerson - currentPartnerCount
  );

  if (numberOfPartnersToAdd > newPartnerOptions.length) {
    numberOfPartnersToAdd = newPartnerOptions.length;
  }

  const newPartners = shuffle(newPartnerOptions).slice(
    0,
    numberOfPartnersToAdd
  );

  return newPartners;
};

const onSliderChange = (elementId) => {
  const inputElement = document.getElementById(elementId);
  const displayElement = document.getElementById(elementId + "-value");
  displayElement.innerHTML = inputElement.value;
  SLIDER_VALUES[elementId] = Number(inputElement.value);
  if (elementId === "fractionOfPeopleTravelling") {
    animation.persons.forEach((p) => p.assignTravels());
  }
  if (elementId === "avgNumPartnersPerPerson") {
    animation.assignPartners();
  }
};

// ---------------------------------------------
// ------------------- Chart -------------------
// ---------------------------------------------

const intialChartData = [
  {
    type: "line",
    axisYType: "secondary",
    name: statuses.healthy.name,
    color: statuses.healthy.color,
    showInLegend: true,
    markerSize: 0,
    dataPoints: [],
  },
  {
    type: "line",
    axisYType: "secondary",
    name: statuses.sick.name,
    color: statuses.sick.color,
    showInLegend: true,
    markerSize: 0,
    dataPoints: [],
  },
  {
    type: "line",
    axisYType: "secondary",
    name: statuses.recovered.name,
    color: statuses.recovered.color,
    showInLegend: true,
    markerSize: 0,
    dataPoints: [],
  },
  {
    type: "line",
    axisYType: "secondary",
    name: statuses.deceased.name,
    color: statuses.deceased.color,
    showInLegend: true,
    markerSize: 0,
    dataPoints: [],
  },
];

const chart = new CanvasJS.Chart("chart-container", {
  axisX: {
    title: "Days",
  },
  axisY2: {
    title: "People",
  },
  toolTip: {
    shared: true,
  },
  legend: {
    cursor: "pointer",
    verticalAlign: "top",
    horizontalAlign: "center",
    dockInsidePlotArea: true,
    itemclick: () => console.log("itemclick"),
  },
  backgroundColor: "#ffffff99",
  theme: "light2",
  data: intialChartData,
});

chart.render();

// ---------------------------------------------
// ----------- Instantiate Animation -----------
// ---------------------------------------------

const partnersStore = new PartnerStore();
const animation = new Animation(
  svg,
  partnersStore,
  chart,
  intialChartData,
  timerElement,
  healthyCounterElement,
  sickCounterElement,
  recoveredCounterElement,
  deceasedCounterElement,
  startOrPauseButton
);
